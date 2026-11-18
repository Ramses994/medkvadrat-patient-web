import type {
  ApiEnvelope,
  Appointment,
  OtpRequestResult,
  OtpVerifyResult,
  Profile,
  RuntimeConfig,
  TokenPair,
} from './types';
import { clearAccessToken, getAccessToken, setAccessToken } from '../session/tokenStore';
import {
  ACCESS_REFRESH_SKEW_MS,
  clearLogoutFlag,
  combineSignals,
  getAbortSignal,
  getGeneration,
  getServerSession,
  hasLogoutFlag,
  isCurrentGeneration,
  isSessionChangedError,
  isStaleSessionError,
  nowMs,
  PREEMPT_REFRESH_MIN_TTL_SEC,
  REFRESH_RACE_RETRY_MS,
  SessionChangedError,
  setServerSession,
  StaleSessionError,
  waitForLogoutSettled,
} from '../session/sessionGate';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, status: number, retryable: boolean) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

type RefreshFn = () => Promise<boolean>;

let refreshFn: RefreshFn | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let refreshSessionInFlight: Promise<TokenPair> | null = null;
let onSessionLost: (() => void) | null = null;
let onSessionChanged: (() => void) | null = null;
let displayUntilMs = 0;
let displayExpiryTimer = 0;
let preemptRefreshTimer = 0;
let onDisplayExpired: (() => void) | null = null;
let onPreemptRefresh: (() => void) | null = null;

export function configureSessionHooks(hooks: {
  refresh: RefreshFn;
  onSessionLost: () => void;
  onSessionChanged?: () => void;
  onDisplayExpired?: () => void;
  onPreemptRefresh?: () => void;
}): void {
  refreshFn = hooks.refresh;
  onSessionLost = hooks.onSessionLost;
  onSessionChanged = hooks.onSessionChanged ?? null;
  onDisplayExpired = hooks.onDisplayExpired ?? null;
  onPreemptRefresh = hooks.onPreemptRefresh ?? null;
}

export function resetSharedRefresh(): void {
  refreshInFlight = null;
  refreshSessionInFlight = null;
}

export function getDisplayUntilMs(): number {
  return displayUntilMs;
}

/** Patient data may render only while the local display clock has not elapsed. */
export function canDisplayPatientData(): boolean {
  return displayUntilMs > 0 && nowMs() < displayUntilMs;
}

export function isDisplayExpired(): boolean {
  return displayUntilMs > 0 && nowMs() >= displayUntilMs;
}

export function clearAccessSchedule(): void {
  displayUntilMs = 0;
  if (displayExpiryTimer) {
    window.clearTimeout(displayExpiryTimer);
    displayExpiryTimer = 0;
  }
  if (preemptRefreshTimer) {
    window.clearTimeout(preemptRefreshTimer);
    preemptRefreshTimer = 0;
  }
}

function scheduleDisplayTimers(expiresInSec: number): void {
  clearAccessSchedule();
  const issued = nowMs();
  const ttlMs = Math.max(0, expiresInSec) * 1000;
  displayUntilMs = issued + ttlMs;

  displayExpiryTimer = window.setTimeout(() => {
    onDisplayExpired?.();
  }, ttlMs);

  // Preemptive refresh 30s before displayUntil only when TTL > 60s.
  if (expiresInSec > PREEMPT_REFRESH_MIN_TTL_SEC) {
    const delay = Math.max(0, ttlMs - ACCESS_REFRESH_SKEW_MS);
    preemptRefreshTimer = window.setTimeout(() => {
      onPreemptRefresh?.();
    }, delay);
  }
}

async function sharedRefresh(): Promise<boolean> {
  if (!refreshFn) return false;
  if (!refreshInFlight) {
    const gen = getGeneration();
    refreshInFlight = (async () => {
      try {
        const ok = await refreshFn();
        if (!isCurrentGeneration(gen)) return false;
        return ok;
      } catch (e) {
        if (isStaleSessionError(e) || isSessionChangedError(e)) return false;
        return false;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export function __testSharedRefreshState(): { inFlight: boolean } {
  return { inFlight: refreshInFlight !== null || refreshSessionInFlight !== null };
}

async function parseEnvelope<T>(res: Response): Promise<ApiEnvelope<T>> {
  const text = await res.text();
  if (!text) return { success: res.ok };
  try {
    return JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    return { success: false, error_details: { code: 'INTERNAL', message: 'bad json' } };
  }
}

function raise(env: ApiEnvelope<unknown>, status: number): never {
  const code = env.error_details?.code || (status >= 500 ? 'INTERNAL' : 'INTERNAL');
  const retryable = status === 0 || status >= 500 || code === 'INTERNAL';
  throw new ApiError(code, status, retryable);
}

function loseSession(): never {
  clearAccessToken();
  setServerSession(null);
  clearAccessSchedule();
  onSessionLost?.();
  throw new ApiError('UNAUTHORIZED', 401, false);
}

function sessionChanged(): never {
  clearAccessToken();
  setServerSession(null);
  clearAccessSchedule();
  onSessionChanged?.();
  throw new SessionChangedError();
}

type RequestOpts = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  retryOn401?: boolean;
  signal?: AbortSignal;
  afterLogout?: boolean;
  ignoreSessionAbort?: boolean;
};

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  if (opts.afterLogout) {
    await waitForLogoutSettled();
  }

  const gen = getGeneration();
  const signal = opts.ignoreSessionAbort
    ? opts.signal
    : combineSignals(getAbortSignal(), opts.signal);

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (path.startsWith('/api/auth/')) {
    headers['X-LK-Client'] = 'web';
  }
  if (opts.auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      signal,
      keepalive: opts.ignoreSessionAbort === true,
    });
  } catch (e) {
    if (!isCurrentGeneration(gen) || (e instanceof DOMException && e.name === 'AbortError')) {
      resetSharedRefresh();
      throw new StaleSessionError();
    }
    throw new ApiError('NETWORK', 0, true);
  }

  if (!opts.ignoreSessionAbort && !isCurrentGeneration(gen)) {
    resetSharedRefresh();
    throw new StaleSessionError();
  }

  if (res.status === 401 && opts.auth) {
    if (opts.retryOn401 !== false) {
      const ok = await sharedRefresh();
      if (!isCurrentGeneration(gen)) {
        resetSharedRefresh();
        throw new StaleSessionError();
      }
      if (ok) {
        return request<T>(path, { ...opts, retryOn401: false });
      }
      loseSession();
    }
    loseSession();
  }

  if (res.status === 204) {
    if (!opts.ignoreSessionAbort && !isCurrentGeneration(gen)) throw new StaleSessionError();
    return undefined as T;
  }

  const env = await parseEnvelope<T>(res);
  if (!opts.ignoreSessionAbort && !isCurrentGeneration(gen)) {
    resetSharedRefresh();
    throw new StaleSessionError();
  }

  if (res.status === 409) {
    const code = env.error_details?.code || '';
    if (code === 'SESSION_CHANGED') sessionChanged();
    if (code === 'REFRESH_RACE') {
      throw new ApiError('REFRESH_RACE', 409, true);
    }
  }

  if (!res.ok || env.success === false) {
    raise(env, res.status);
  }
  return env.data as T;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const res = await fetch('/runtime-config.json', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return { clinic_phone: import.meta.env.VITE_CLINIC_PHONE ?? '' };
    const data = (await res.json()) as RuntimeConfig;
    if (data.clinic_phone) return data;
  } catch {
    // fall through
  }
  return { clinic_phone: import.meta.env.VITE_CLINIC_PHONE ?? '' };
}

export function requestOtp(phone: string): Promise<OtpRequestResult> {
  return request('/api/auth/otp/request', { body: { phone }, afterLogout: true });
}

export function verifyOtp(requestId: string, code: string): Promise<OtpVerifyResult> {
  return request('/api/auth/otp/verify', { body: { request_id: requestId, code }, afterLogout: true });
}

export function selectPatient(requestId: string, patientId: number): Promise<TokenPair> {
  return request('/api/auth/otp/select-patient', {
    body: { request_id: requestId, patient_id: patientId },
    afterLogout: true,
  });
}

export function applyTokens(data: TokenPair): void {
  setAccessToken(data.access);
  if (data.session) setServerSession(data.session);
  if (typeof data.access_expires_in === 'number') {
    scheduleDisplayTimers(data.access_expires_in);
  }
}

async function refreshOnce(gen: number): Promise<TokenPair> {
  const session = getServerSession();
  const body: Record<string, string> = {};
  if (session) body.session = session;
  const data = await request<TokenPair>('/api/auth/refresh', {
    method: 'POST',
    body,
    retryOn401: false,
  });
  if (!isCurrentGeneration(gen)) {
    resetSharedRefresh();
    throw new StaleSessionError();
  }
  applyTokens(data);
  return data;
}

async function refreshSessionInner(): Promise<TokenPair> {
  const gen = getGeneration();
  try {
    return await refreshOnce(gen);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'REFRESH_RACE') {
      await new Promise((r) => setTimeout(r, REFRESH_RACE_RETRY_MS));
      if (!isCurrentGeneration(gen)) throw new StaleSessionError();
      try {
        return await refreshOnce(gen);
      } catch (e2) {
        if (e2 instanceof ApiError && e2.code === 'REFRESH_RACE') {
          loseSession();
        }
        throw e2;
      }
    }
    throw e;
  }
}

/** At most one refresh in flight across preempt / displayUntil / 401 retry. */
export async function refreshSession(): Promise<TokenPair> {
  if (!refreshSessionInFlight) {
    refreshSessionInFlight = refreshSessionInner().finally(() => {
      refreshSessionInFlight = null;
    });
  }
  return refreshSessionInFlight;
}

/**
 * Ю1/Ю2: show «checking», then one refresh; only mutate UI if generation is still current.
 */
export async function revalidateDisplay(hooks: {
  onChecking: () => void;
  onOk: () => void;
  onFail: () => void;
}): Promise<void> {
  const gen = getGeneration();
  hooks.onChecking();
  try {
    await refreshSession();
    if (!isCurrentGeneration(gen)) return;
    hooks.onOk();
  } catch {
    if (!isCurrentGeneration(gen)) return;
    hooks.onFail();
  }
}

/**
 * Logout with keepalive outside the shared AbortController.
 * Pass session explicitly so it survives local clear (Ш4).
 * Omit session for post-F5 logout-flag recovery (Ш2).
 */
export function logoutSession(session?: string | null): Promise<void> {
  const body: Record<string, string> = {};
  const sid = session === undefined ? getServerSession() : session;
  if (sid) body.session = sid;
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), 5_000);
  return request<void>('/api/auth/logout', {
    method: 'POST',
    body,
    retryOn401: false,
    signal: ac.signal,
    ignoreSessionAbort: true,
  }).finally(() => window.clearTimeout(timer));
}

/**
 * Run logout and clear lk_logout after any HTTP outcome.
 * Keep the flag on network failure or the 5s client abort (Э1).
 */
export async function logoutClearingFlag(session?: string | null): Promise<'ok' | 'keep'> {
  try {
    await logoutSession(session);
    clearLogoutFlag();
    return 'ok';
  } catch (e) {
    if (e instanceof ApiError && e.code === 'NETWORK') return 'keep';
    // logoutSession maps the 5s AbortController abort to StaleSessionError.
    if (isStaleSessionError(e)) return 'keep';
    clearLogoutFlag();
    return 'ok';
  }
}

/** Logout after F5 with the logout flag: no session in body; clear flag unless keep. */
export async function logoutAfterFlag(): Promise<'ok' | 'network'> {
  const result = await logoutClearingFlag(null);
  return result === 'keep' ? 'network' : 'ok';
}

export function getProfile(): Promise<Profile> {
  return request('/api/me/profile', { auth: true });
}

export function getAppointments(status: 'upcoming' | 'past'): Promise<Appointment[]> {
  return request(`/api/me/appointments?status=${status}`, { auth: true });
}

export function getVisits(from: string, to: string): Promise<Appointment[]> {
  return request(`/api/me/visits?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
    auth: true,
  });
}

export async function quietBootstrap(): Promise<boolean> {
  if (hasLogoutFlag()) return false;
  try {
    await refreshSession();
    return true;
  } catch (e) {
    if (isStaleSessionError(e) || isSessionChangedError(e)) return false;
    clearAccessToken();
    setServerSession(null);
    clearAccessSchedule();
    return false;
  }
}
