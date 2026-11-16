/** In-memory session generation + opaque server session id for this tab. */

export const TAB_CHANNEL = 'lk-patient-web-session';
export const LOGOUT_TIMEOUT_MS = 5_000;
export const REFRESH_RACE_RETRY_MS = 300;

export class StaleSessionError extends Error {
  constructor() {
    super('stale-session');
    this.name = 'StaleSessionError';
  }
}

export function isStaleSessionError(e: unknown): e is StaleSessionError {
  return e instanceof StaleSessionError;
}

export class SessionChangedError extends Error {
  constructor() {
    super('session-changed');
    this.name = 'SessionChangedError';
  }
}

export function isSessionChangedError(e: unknown): e is SessionChangedError {
  return e instanceof SessionChangedError;
}

let generation = 0;
let controller = new AbortController();
let logoutWait: Promise<void> | null = null;
let serverSession: string | null = null;
const tabId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}`;

export type TabMessage =
  | { type: 'logout'; tabId: string; session?: string }
  | { type: 'login'; tabId: string; session?: string };

let channel: BroadcastChannel | null = null;
let channelListener: ((msg: TabMessage) => void) | null = null;

export function getTabId(): string {
  return tabId;
}

export function getGeneration(): number {
  return generation;
}

export function getAbortSignal(): AbortSignal {
  return controller.signal;
}

export function getServerSession(): string | null {
  return serverSession;
}

export function setServerSession(session: string | null): void {
  serverSession = session;
}

/** Abort in-flight work (except keepalive logout) and advance the generation. */
export function advanceSession(): number {
  generation += 1;
  controller.abort();
  controller = new AbortController();
  return generation;
}

export function isCurrentGeneration(gen: number): boolean {
  return gen === generation;
}

export function waitForLogoutSettled(): Promise<void> {
  return logoutWait ?? Promise.resolve();
}

/** Run logout network work; waiters (OTP) unblock after settle or timeout. */
export function trackLogoutNetwork(work: () => Promise<void>): Promise<void> {
  const timed = Promise.race([
    work().catch(() => undefined),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, LOGOUT_TIMEOUT_MS);
    }),
  ]);
  const tracked = timed.finally(() => {
    if (logoutWait === tracked) logoutWait = null;
  });
  logoutWait = tracked;
  return tracked;
}

export function combineSignals(primary: AbortSignal, extra?: AbortSignal): AbortSignal {
  if (!extra) return primary;
  if (typeof AbortSignal !== 'undefined' && 'any' in AbortSignal && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([primary, extra]);
  }
  const out = new AbortController();
  const abort = () => out.abort();
  if (primary.aborted || extra.aborted) {
    out.abort();
    return out.signal;
  }
  primary.addEventListener('abort', abort, { once: true });
  extra.addEventListener('abort', abort, { once: true });
  return out.signal;
}

/** One permanent BroadcastChannel per tab; ignore own tabId. */
export function ensureTabChannel(onMessage: (msg: TabMessage) => void): () => void {
  channelListener = onMessage;
  if (!channel) {
    try {
      channel = new BroadcastChannel(TAB_CHANNEL);
      channel.onmessage = (ev: MessageEvent<TabMessage>) => {
        const msg = ev.data;
        if (!msg || typeof msg !== 'object' || msg.tabId === tabId) return;
        channelListener?.(msg);
      };
    } catch {
      channel = null;
    }
  }
  return () => {
    if (channelListener === onMessage) channelListener = null;
  };
}

export function broadcastTab(msg: Omit<TabMessage, 'tabId'>): void {
  if (!channel) {
    try {
      channel = new BroadcastChannel(TAB_CHANNEL);
    } catch {
      return;
    }
  }
  channel.postMessage({ ...msg, tabId });
}

/** Cross-tab refresh serialization; falls back to direct call when locks are missing. */
export async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) return fn();
  return locks.request('lk-patient-web-refresh', fn);
}

/** Legacy name used by older imports. */
export const LOGOUT_CHANNEL = TAB_CHANNEL;
