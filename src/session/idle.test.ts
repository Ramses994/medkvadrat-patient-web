import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_TIMEOUT_MS, startIdleWatch } from './idle';

describe('idle logout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires after 15 minutes without activity', () => {
    const onIdle = vi.fn();
    const stop = startIdleWatch(onIdle);
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    stop();
  });

  it('resets the timer on activity', () => {
    const onIdle = vi.fn();
    const stop = startIdleWatch(onIdle);
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1000);
    window.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    stop();
  });

  it('logs out on visibility resume after sleep without the timer firing', () => {
    const onIdle = vi.fn();
    let hidden = false;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    });

    const stop = startIdleWatch(onIdle);

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));

    // 16 minutes pass in the background; the timer is cleared while hidden.
    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(onIdle).not.toHaveBeenCalled();

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onIdle).toHaveBeenCalledTimes(1);

    // A later focus must not fire again.
    window.dispatchEvent(new Event('focus'));
    expect(onIdle).toHaveBeenCalledTimes(1);
    stop();
  });

  it('logs out on mousemove when 16 minutes already elapsed without the timer', () => {
    const onIdle = vi.fn();
    let hidden = false;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    });

    const stop = startIdleWatch(onIdle);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(onIdle).not.toHaveBeenCalled();

    // Stay "hidden" so the timer does not fire; activity bump must still logout.
    window.dispatchEvent(new Event('mousemove'));
    expect(onIdle).toHaveBeenCalledTimes(1);
    stop();
  });
});
