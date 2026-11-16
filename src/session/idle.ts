const IDLE_MS = 15 * 60 * 1000;

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'pointerdown',
  'keydown',
  'touchstart',
  'mousemove',
  'scroll',
];

/** Calls onIdle after 15 minutes without user activity, including after sleep / background tabs. */
export function startIdleWatch(onIdle: () => void, idleMs = IDLE_MS): () => void {
  let lastActivity = Date.now();
  let fired = false;
  let timer = 0;

  const fire = () => {
    if (fired) return;
    fired = true;
    window.clearTimeout(timer);
    onIdle();
  };

  const elapsed = () => Date.now() - lastActivity;

  const schedule = () => {
    window.clearTimeout(timer);
    if (fired) return;
    // Background tabs throttle timers; while hidden we rely on resume checks instead.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }
    const remaining = idleMs - elapsed();
    if (remaining <= 0) {
      fire();
      return;
    }
    timer = window.setTimeout(() => {
      if (elapsed() >= idleMs) fire();
      else schedule();
    }, remaining);
  };

  const bump = () => {
    if (fired) return;
    lastActivity = Date.now();
    schedule();
  };

  /** On return to the tab: logout immediately if idle, before any /api/me work. */
  const checkResume = () => {
    if (fired) return;
    if (elapsed() >= idleMs) {
      fire();
      return;
    }
    schedule();
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      window.clearTimeout(timer);
      return;
    }
    checkResume();
  };

  schedule();

  for (const ev of ACTIVITY_EVENTS) {
    window.addEventListener(ev, bump, { passive: true });
  }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', checkResume);
  window.addEventListener('pageshow', checkResume);

  return () => {
    window.clearTimeout(timer);
    for (const ev of ACTIVITY_EVENTS) {
      window.removeEventListener(ev, bump);
    }
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', checkResume);
    window.removeEventListener('pageshow', checkResume);
  };
}

export const IDLE_TIMEOUT_MS = IDLE_MS;
