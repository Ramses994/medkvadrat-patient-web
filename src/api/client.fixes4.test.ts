import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureSessionHooks,
  logoutClearingFlag,
  logoutSession,
  quietBootstrap,
  refreshSession,
  resetSharedRefresh,
} from './client';
import {
  advanceSession,
  clearLogoutFlag,
  getGeneration,
  hasLogoutFlag,
  setLogoutFlag,
  setServerSession,
} from '../session/sessionGate';
import { clearAccessToken, getAccessToken, setAccessToken } from '../session/tokenStore';

describe('fixes-4 session client', () => {
  beforeEach(() => {
    clearAccessToken();
    clearLogoutFlag();
    setServerSession(null);
    resetSharedRefresh();
    advanceSession();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    clearAccessToken();
    clearLogoutFlag();
    setServerSession(null);
    resetSharedRefresh();
  });

  it('discards a response from a past generation', async () => {
    configureSessionHooks({
      refresh: async () => false,
      onSessionLost: () => undefined,
    });
    const fetchMock = vi.mocked(fetch);
    let resolveFetch!: (r: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveFetch = r;
        }),
    );
    const genAtSend = getGeneration();
    const pending = refreshSession();
    advanceSession();
    expect(getGeneration()).not.toBe(genAtSend);
    resolveFetch(
      new Response(
        JSON.stringify({
          success: true,
          data: { access: 'late', access_expires_in: 900, session: 'sid-late' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(pending).rejects.toMatchObject({ name: 'StaleSessionError' });
    expect(getAccessToken()).toBeNull();
  });

  it('logout body includes the session id', async () => {
    setServerSession('sid-manual');
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await logoutSession('sid-manual');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ session: 'sid-manual' });
  });

  it('retries once on REFRESH_RACE then succeeds', async () => {
    setServerSession('sid-1');
    setAccessToken('old');
    configureSessionHooks({
      refresh: async () => false,
      onSessionLost: () => undefined,
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error_details: { code: 'REFRESH_RACE', message: 'race' },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: { access: 'fresh', access_expires_in: 900, session: 'sid-1' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.useFakeTimers();
    const p = refreshSession();
    await vi.advanceTimersByTimeAsync(300);
    const tok = await p;
    expect(tok.access).toBe('fresh');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('second REFRESH_RACE loses the session', async () => {
    setServerSession('sid-1');
    setAccessToken('old');
    const onSessionLost = vi.fn();
    configureSessionHooks({
      refresh: async () => false,
      onSessionLost,
    });
    const raceBody = JSON.stringify({
      success: false,
      error_details: { code: 'REFRESH_RACE', message: 'race' },
    });
    const raceRes = () =>
      new Response(raceBody, { status: 409, headers: { 'Content-Type': 'application/json' } });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(raceRes()).mockResolvedValueOnce(raceRes());
    vi.useFakeTimers();
    let caught: unknown;
    const p = refreshSession().then(
      () => {
        throw new Error('expected refresh to fail');
      },
      (e) => {
        caught = e;
      },
    );
    await vi.advanceTimersByTimeAsync(300);
    await p;
    expect(caught).toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    expect(onSessionLost).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });

  it('skips quiet restore when logout flag is set', async () => {
    setLogoutFlag();
    expect(hasLogoutFlag()).toBe(true);
    const fetchMock = vi.mocked(fetch);
    const ok = await quietBootstrap();
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears logout flag after logout HTTP response', async () => {
    setLogoutFlag();
    setServerSession('sid-1');
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(logoutClearingFlag('sid-1')).resolves.toBe('ok');
    expect(hasLogoutFlag()).toBe(false);
  });

  it('keeps logout flag on network error', async () => {
    setLogoutFlag();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(logoutClearingFlag(null)).resolves.toBe('keep');
    expect(hasLogoutFlag()).toBe(true);
  });
});
