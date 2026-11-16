import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureSessionHooks, getProfile, resetSharedRefresh } from './client';
import { advanceSession } from '../session/sessionGate';
import { clearAccessToken, getAccessToken, setAccessToken } from '../session/tokenStore';

describe('second 401 after refresh ends session (У3)', () => {
  beforeEach(() => {
    clearAccessToken();
    resetSharedRefresh();
    advanceSession();
    setAccessToken('stale-access');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAccessToken();
    resetSharedRefresh();
  });

  it('401 → refresh OK → retry 401 → logout once, no token', async () => {
    const onSessionLost = vi.fn();
    let refreshCalls = 0;

    configureSessionHooks({
      refresh: async () => {
        refreshCalls += 1;
        setAccessToken('fresh-access');
        return true;
      },
      onSessionLost,
    });

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/me/profile')) {
        return new Response(
          JSON.stringify({
            success: false,
            error_details: { code: 'UNAUTHORIZED', message: 'x' },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`unexpected ${url}`);
    });

    await expect(getProfile()).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    expect(refreshCalls).toBe(1);
    expect(onSessionLost).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });
});
