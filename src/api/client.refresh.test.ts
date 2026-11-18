import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __testSharedRefreshState,
  configureSessionHooks,
  getAppointments,
  getProfile,
} from './client';
import { setAccessToken, clearAccessToken } from '../session/tokenStore';

describe('shared refresh on parallel 401', () => {
  beforeEach(() => {
    clearAccessToken();
    setAccessToken('stale-access');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAccessToken();
  });

  it('runs one refresh for parallel me requests', async () => {
    let refreshCalls = 0;
    let resolveRefresh!: (ok: boolean) => void;
    const refreshGate = new Promise<boolean>((r) => {
      resolveRefresh = r;
    });

    configureSessionHooks({
      refresh: async () => {
        refreshCalls += 1;
        return refreshGate;
      },
      onSessionLost: () => undefined,
    });

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/me/')) {
        if (refreshCalls === 0) {
          return new Response(JSON.stringify({ success: false, error_details: { code: 'UNAUTHORIZED', message: 'x' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const data = url.includes('profile')
          ? { patient_id: 900001, full_name: 'Иванов Иван Иванович', phone: '+79000000000', email: 'ivan@example.test' }
          : [];
        return new Response(JSON.stringify({ success: true, data }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected ${url}`);
    });

    const p1 = getProfile();
    const p2 = getAppointments('upcoming');

    // Both should be waiting on the same in-flight refresh.
    await Promise.resolve();
    expect(__testSharedRefreshState().inFlight).toBe(true);
    expect(refreshCalls).toBe(1);

    setAccessToken('fresh-access');
    resolveRefresh(true);

    const [profile, appts] = await Promise.all([p1, p2]);
    expect(profile.full_name).toBe('Иванов Иван Иванович');
    expect(appts).toEqual([]);
    expect(refreshCalls).toBe(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});
