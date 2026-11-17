/** In-memory session generation + opaque server session id for this tab. */

export const TAB_CHANNEL = 'lk-cabinet-tab';
export const CABINET_LOCK = 'lk-cabinet';
export const LOGOUT_FLAG = 'lk_logout';
export const LOGOUT_TIMEOUT_MS = 5_000;
export const REFRESH_RACE_RETRY_MS = 300;
export const ACCESS_REFRESH_SKEW_MS = 30_000;

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
/** Controllable clock for access-expiry timers (tests may replace). */
export let nowMs = () => Date.now();
export function setNowMs(fn: () => number): void {
  nowMs = fn;
}

const tabId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}`;

export type TabMessage = { type: 'takeover'; tabId: string };

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

export function setLogoutFlag(): void {
  try {
    sessionStorage.setItem(LOGOUT_FLAG, '1');
  } catch {
    // ignore
  }
}

export function hasLogoutFlag(): boolean {
  try {
    return sessionStorage.getItem(LOGOUT_FLAG) === '1';
  } catch {
    return false;
  }
}

export function clearLogoutFlag(): void {
  try {
    sessionStorage.removeItem(LOGOUT_FLAG);
  } catch {
    // ignore
  }
}

/** Permanent BroadcastChannel for takeover only; ignore own tabId. */
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

export function broadcastTakeover(): void {
  if (!channel) {
    try {
      channel = new BroadcastChannel(TAB_CHANNEL);
    } catch {
      return;
    }
  }
  channel.postMessage({ type: 'takeover', tabId } satisfies TabMessage);
}

export function locksSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.locks?.request;
}

type LockHandle = { release: () => void };

/**
 * Hold the exclusive cabinet lock for the lifetime of this tab.
 * Returns null if another tab already holds it (ifAvailable).
 */
export async function acquireCabinetLock(): Promise<LockHandle | null> {
  const locks = navigator.locks;
  if (!locks?.request) return null;

  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });

  const got = await new Promise<boolean>((resolve) => {
    void locks.request(CABINET_LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        resolve(false);
        return;
      }
      resolve(true);
      await held;
    });
  });

  if (!got) return null;
  return { release };
}

/** Blocking acquire after the previous owner released (e.g. «Открыть здесь»). */
export async function waitCabinetLock(): Promise<LockHandle> {
  const locks = navigator.locks;
  if (!locks?.request) {
    return { release: () => undefined };
  }
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  let acquired!: () => void;
  const ready = new Promise<void>((r) => {
    acquired = r;
  });
  void locks.request(CABINET_LOCK, async () => {
    acquired();
    await held;
  });
  await ready;
  return { release };
}
