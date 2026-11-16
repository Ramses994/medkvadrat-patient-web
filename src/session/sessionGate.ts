/** In-memory session generation: bump on login, logout, and session loss. */

export const LOGOUT_CHANNEL = 'lk-patient-web-logout';
export const LOGOUT_TIMEOUT_MS = 5_000;

export class StaleSessionError extends Error {
  constructor() {
    super('stale-session');
    this.name = 'StaleSessionError';
  }
}

export function isStaleSessionError(e: unknown): e is StaleSessionError {
  return e instanceof StaleSessionError;
}

let generation = 0;
let controller = new AbortController();
let logoutWait: Promise<void> | null = null;

export function getGeneration(): number {
  return generation;
}

export function getAbortSignal(): AbortSignal {
  return controller.signal;
}

/** Abort in-flight work and advance the generation. */
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
