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
  combineSignals,
  getAbortSignal,
  getGeneration,
  isCurrentGeneration,
  isStaleSessionError,
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
let onSessionLost: (() => void) | null = null;

export function configureSessionHooks(hooks: {
  refresh: RefreshFn;
  onSessionLost: () => void;
}): void {
  refreshFn = hooks.refresh;
  onSessionLost = hooks.onSessionLost;
}

/** Drop a shared refresh so a new session never waits on a stale one. */
export function resetSharedRefresh(): void {
  refreshInFlight = null;
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
        if (isStaleSessionError(e)) return false;
        return false;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Exposed for Vitest: parallel 401s wait on one refresh. */
export function __testSharedRefreshState(): { inFlight: boolean } {
  return { inFlight: refreshInFlight !== null };
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
  onSessionLost?.();
  throw new ApiError('UNAUTHORIZED', 401, false);
}

type RequestOpts = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  /** When true, a 401 triggers one shared refresh and one retry. */
  retryOn401?: boolean;
  signal?: AbortSignal;
  /** Wait for an in-flight logout before sending (OTP request/verify). */
  afterLogout?: boolean;
};

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  if (opts.afterLogout) {
    await waitForLogoutSettled();
  }

  const gen = getGeneration();
  const signal = combineSignals(getAbortSignal(), opts.signal);

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  // Auth routes for the web cabinet always send the client marker.
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
    });
  } catch (e) {
    if (!isCurrentGeneration(gen) || (e instanceof DOMException && e.name === 'AbortError')) {
      resetSharedRefresh();
      throw new StaleSessionError();
    }
    throw new ApiError('NETWORK', 0, true);
  }

  if (!isCurrentGeneration(gen)) {
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
    // Second 401 after a successful refresh ends the session (У3).
    loseSession();
  }

  if (res.status === 204) {
    if (!isCurrentGeneration(gen)) throw new StaleSessionError();
    return undefined as T;
  }

  const env = await parseEnvelope<T>(res);
  if (!isCurrentGeneration(gen)) {
    resetSharedRefresh();
    throw new StaleSessionError();
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

export async function refreshSession(): Promise<TokenPair> {
  const gen = getGeneration();
  const data = await request<TokenPair>('/api/auth/refresh', {
    method: 'POST',
    body: {},
    retryOn401: false,
  });
  if (!isCurrentGeneration(gen)) {
    resetSharedRefresh();
    throw new StaleSessionError();
  }
  setAccessToken(data.access);
  return data;
}

export function logoutSession(signal?: AbortSignal): Promise<void> {
  return request('/api/auth/logout', {
    method: 'POST',
    body: {},
    retryOn401: false,
    signal,
  });
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

/** Quiet bootstrap refresh: returns false when there is no session cookie. */
export async function quietBootstrap(): Promise<boolean> {
  try {
    await refreshSession();
    return true;
  } catch (e) {
    if (isStaleSessionError(e)) return false;
    clearAccessToken();
    return false;
  }
}
