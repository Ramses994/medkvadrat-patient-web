import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyTokens,
  clearAccessSchedule,
  configureSessionHooks,
  ensureFreshAccess,
  loadRuntimeConfig,
  logoutAfterFlag,
  logoutSession,
  quietBootstrap,
  refreshSession,
  resetSharedRefresh,
} from './api/client';
import type { PatientCandidate, TokenPair } from './api/types';
import { AppointmentsScreen } from './screens/AppointmentsScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { LoginScreen } from './screens/LoginScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SelectProfileScreen } from './screens/SelectProfileScreen';
import { startIdleWatch } from './session/idle';
import {
  acquireCabinetLock,
  advanceSession,
  broadcastTakeover,
  ensureTabChannel,
  getGeneration,
  getServerSession,
  hasLogoutFlag,
  isCurrentGeneration,
  isSessionChangedError,
  locksSupported,
  setLogoutFlag,
  setServerSession,
  trackLogoutNetwork,
  waitCabinetLock,
} from './session/sessionGate';
import { clearAccessToken } from './session/tokenStore';

type Tab = 'appointments' | 'history' | 'profile';
type Phase =
  | { kind: 'boot' }
  | { kind: 'unsupported' }
  | { kind: 'blocked' }
  | { kind: 'taken' }
  | { kind: 'login' }
  | { kind: 'select'; requestId: string; candidates: PatientCandidate[] }
  | { kind: 'cabinet'; tab: Tab };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'boot' });
  const [clinicPhone, setClinicPhone] = useState('');
  const lockRelease = useRef<(() => void) | null>(null);

  const showLogin = useCallback(() => {
    setPhase({ kind: 'login' });
  }, []);

  const endLocalSession = useCallback(() => {
    advanceSession();
    resetSharedRefresh();
    clearAccessToken();
    setServerSession(null);
    clearAccessSchedule();
    showLogin();
  }, [showLogin]);

  const doLogout = useCallback(async () => {
    const session = getServerSession();
    setLogoutFlag();
    endLocalSession();
    await trackLogoutNetwork(() => logoutSession(session));
  }, [endLocalSession]);

  const enterCabinet = useCallback((tokens: TokenPair) => {
    advanceSession();
    resetSharedRefresh();
    applyTokens(tokens);
    setPhase({ kind: 'cabinet', tab: 'appointments' });
  }, []);

  const releaseLock = useCallback(() => {
    lockRelease.current?.();
    lockRelease.current = null;
  }, []);

  const bootCabinet = useCallback(async () => {
    const bootGen = getGeneration();
    const cfg = await loadRuntimeConfig();
    if (!isCurrentGeneration(bootGen)) return;
    setClinicPhone(cfg.clinic_phone || '');

    if (hasLogoutFlag()) {
      await logoutAfterFlag();
      if (!isCurrentGeneration(bootGen)) return;
      setPhase({ kind: 'login' });
      return;
    }

    const ok = await quietBootstrap();
    if (!isCurrentGeneration(bootGen)) return;
    if (ok) setPhase({ kind: 'cabinet', tab: 'appointments' });
    else setPhase({ kind: 'login' });
  }, []);

  const openHere = useCallback(async () => {
    broadcastTakeover();
    releaseLock();
    const handle = await waitCabinetLock();
    lockRelease.current = handle.release;
    advanceSession();
    resetSharedRefresh();
    clearAccessToken();
    setServerSession(null);
    clearAccessSchedule();
    setPhase({ kind: 'boot' });
    await bootCabinet();
  }, [bootCabinet, releaseLock]);

  useEffect(() => {
    configureSessionHooks({
      refresh: async () => {
        try {
          await refreshSession();
          return true;
        } catch (e) {
          if (isSessionChangedError(e)) return false;
          return false;
        }
      },
      onSessionLost: () => {
        void doLogout();
      },
      onSessionChanged: () => {
        endLocalSession();
      },
      onAccessRefreshDue: () => {
        void (async () => {
          try {
            await refreshSession();
          } catch {
            endLocalSession();
          }
        })();
      },
    });
  }, [doLogout, endLocalSession]);

  useEffect(() => {
    return ensureTabChannel((msg) => {
      if (msg.type !== 'takeover') return;
      // Yield the cabinet: clear locally, no server logout.
      advanceSession();
      resetSharedRefresh();
      clearAccessToken();
      setServerSession(null);
      clearAccessSchedule();
      setPhase({ kind: 'taken' });
      releaseLock();
    });
  }, [releaseLock]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!locksSupported()) {
        if (!cancelled) setPhase({ kind: 'unsupported' });
        return;
      }
      const handle = await acquireCabinetLock();
      if (cancelled) {
        handle?.release();
        return;
      }
      if (!handle) {
        setPhase({ kind: 'blocked' });
        return;
      }
      lockRelease.current = handle.release;
      await bootCabinet();
    })();
    return () => {
      cancelled = true;
      releaseLock();
    };
  }, [bootCabinet, releaseLock]);

  useEffect(() => {
    if (phase.kind !== 'cabinet') return;
    return startIdleWatch(() => {
      void doLogout();
    });
  }, [phase.kind, doLogout]);

  useEffect(() => {
    if (phase.kind !== 'cabinet') return;
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      void (async () => {
        const ok = await ensureFreshAccess();
        if (!ok) endLocalSession();
      })();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [phase.kind, endLocalSession]);

  if (phase.kind === 'unsupported') {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">МедКвадрат</div>
        </header>
        <section className="panel stack">
          <h1 className="heading-flush">Обновите браузер</h1>
          <p className="muted">Для входа в личный кабинет нужен современный браузер с поддержкой блокировок вкладок.</p>
        </section>
      </div>
    );
  }

  if (phase.kind === 'blocked') {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">МедКвадрат</div>
        </header>
        <section className="panel stack">
          <h1 className="heading-flush">Личный кабинет уже открыт в другой вкладке</h1>
          <p className="muted">Одновременно можно пользоваться только одной вкладкой кабинета.</p>
          <button type="button" className="btn primary" onClick={() => void openHere()}>
            Открыть здесь
          </button>
        </section>
      </div>
    );
  }

  if (phase.kind === 'taken') {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">МедКвадрат</div>
        </header>
        <section className="panel stack">
          <h1 className="heading-flush">Кабинет открыт в другой вкладке</h1>
          <p className="muted">Эта вкладка больше не показывает данные пациента.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">МедКвадрат</div>
        {phase.kind === 'cabinet' ? (
          <button type="button" className="btn ghost" onClick={() => void doLogout()}>
            Выйти
          </button>
        ) : null}
      </header>

      {phase.kind === 'cabinet' ? (
        <nav className="nav" aria-label="Разделы">
          {(
            [
              ['appointments', 'Мои записи'],
              ['history', 'История'],
              ['profile', 'Профиль'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={phase.tab === id ? 'active' : ''}
              onClick={() => setPhase({ kind: 'cabinet', tab: id })}
            >
              {label}
            </button>
          ))}
        </nav>
      ) : null}

      {phase.kind === 'boot' ? <p className="muted">Открываем кабинет…</p> : null}

      {phase.kind === 'login' ? (
        <LoginScreen
          onTokens={(tokens) => enterCabinet(tokens)}
          onCandidates={(requestId, candidates) =>
            setPhase({ kind: 'select', requestId, candidates })
          }
        />
      ) : null}

      {phase.kind === 'select' ? (
        <SelectProfileScreen
          requestId={phase.requestId}
          candidates={phase.candidates}
          onTokens={(tokens) => enterCabinet(tokens)}
          onBack={showLogin}
        />
      ) : null}

      {phase.kind === 'cabinet' && phase.tab === 'appointments' ? (
        <AppointmentsScreen clinicPhone={clinicPhone} />
      ) : null}
      {phase.kind === 'cabinet' && phase.tab === 'history' ? <HistoryScreen /> : null}
      {phase.kind === 'cabinet' && phase.tab === 'profile' ? <ProfileScreen /> : null}

      {phase.kind === 'cabinet' ? (
        <div className="footer-logout">
          <button type="button" className="btn ghost" onClick={() => void doLogout()}>
            Выйти
          </button>
        </div>
      ) : null}
    </div>
  );
}
