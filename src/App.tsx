import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyTokens,
  canDisplayPatientData,
  clearAccessSchedule,
  configureSessionHooks,
  isDisplayExpired,
  loadRuntimeConfig,
  logoutAfterFlag,
  logoutClearingFlag,
  quietBootstrap,
  refreshSession,
  resetSharedRefresh,
  revalidateDisplay,
} from './api/client';
import type { PatientCandidate, TokenPair } from './api/types';
import { AppointmentsScreen } from './screens/AppointmentsScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { LoginScreen } from './screens/LoginScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SelectProfileScreen } from './screens/SelectProfileScreen';
import { startIdleWatch } from './session/idle';
import {
  advanceSession,
  clearLogoutFlag,
  getGeneration,
  getServerSession,
  hasLogoutFlag,
  holdCabinetLock,
  isCurrentGeneration,
  isSessionChangedError,
  locksSupported,
  setLogoutFlag,
  setServerSession,
  trackLogoutNetwork,
} from './session/sessionGate';
import { clearAccessToken } from './session/tokenStore';

type Tab = 'appointments' | 'history' | 'profile';
type Phase =
  | { kind: 'boot' }
  | { kind: 'unsupported' }
  | { kind: 'waiting' }
  | { kind: 'checking' }
  | { kind: 'login' }
  | { kind: 'select'; requestId: string; candidates: PatientCandidate[] }
  | { kind: 'cabinet'; tab: Tab };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'boot' });
  const [ownsLock, setOwnsLock] = useState(false);
  const [clinicPhone, setClinicPhone] = useState('');
  const lockRelease = useRef<(() => void) | null>(null);
  const cabinetTab = useRef<Tab>('appointments');

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
    await trackLogoutNetwork(() => logoutClearingFlag(session).then(() => undefined));
  }, [endLocalSession]);

  const enterCabinet = useCallback((tokens: TokenPair) => {
    advanceSession();
    resetSharedRefresh();
    clearLogoutFlag();
    applyTokens(tokens);
    cabinetTab.current = 'appointments';
    setPhase({ kind: 'cabinet', tab: 'appointments' });
  }, []);

  const releaseLock = useCallback(() => {
    lockRelease.current?.();
    lockRelease.current = null;
    setOwnsLock(false);
  }, []);

  const showCabinet = useCallback((tab?: Tab) => {
    const t = tab ?? cabinetTab.current;
    cabinetTab.current = t;
    setPhase({ kind: 'cabinet', tab: t });
  }, []);

  /** Ю1: hide data immediately, then one refresh; Ю2: ignore if generation changed. */
  const runDisplayRevalidate = useCallback(() => {
    void revalidateDisplay({
      onChecking: () => setPhase({ kind: 'checking' }),
      onOk: () => showCabinet(),
      onFail: () => endLocalSession(),
    });
  }, [endLocalSession, showCabinet]);

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
    if (ok) showCabinet('appointments');
    else setPhase({ kind: 'login' });
  }, [showCabinet]);

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
      onDisplayExpired: () => {
        runDisplayRevalidate();
      },
      onPreemptRefresh: () => {
        const gen = getGeneration();
        void (async () => {
          try {
            await refreshSession();
            if (!isCurrentGeneration(gen)) return;
          } catch {
            // Preempt failure: keep showing data until displayUntil; that path revalidates.
            if (!isCurrentGeneration(gen)) return;
          }
        })();
      },
    });
  }, [doLogout, endLocalSession, runDisplayRevalidate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!locksSupported()) {
        if (!cancelled) setPhase({ kind: 'unsupported' });
        return;
      }
      const handle = await holdCabinetLock(() => {
        if (!cancelled) setPhase({ kind: 'waiting' });
      });
      if (cancelled) {
        handle.release();
        return;
      }
      lockRelease.current = handle.release;
      setOwnsLock(true);
      setPhase({ kind: 'boot' });
      await bootCabinet();
    })();
    return () => {
      cancelled = true;
      releaseLock();
    };
  }, [bootCabinet, releaseLock]);

  useEffect(() => {
    if (!ownsLock || phase.kind !== 'cabinet') return;
    return startIdleWatch(() => {
      void doLogout();
    });
  }, [ownsLock, phase.kind, doLogout]);

  useEffect(() => {
    if (!ownsLock) return;
    const onResume = () => {
      if (document.visibilityState === 'hidden') return;
      if (phase.kind !== 'cabinet' && phase.kind !== 'checking') return;
      if (!isDisplayExpired()) return;
      runDisplayRevalidate();
    };
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onResume);
    window.addEventListener('pageshow', onResume);
    return () => {
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('pageshow', onResume);
    };
  }, [ownsLock, phase.kind, runDisplayRevalidate]);

  // Login / cabinet / select only while this tab owns the lock.
  if (!ownsLock) {
    if (phase.kind === 'unsupported') {
      return (
        <div className="app-shell">
          <header className="topbar">
            <div className="brand">МедКвадрат</div>
          </header>
          <section className="panel stack">
            <h1 className="heading-flush">Обновите браузер</h1>
            <p className="muted">
              Для входа в личный кабинет нужен современный браузер с поддержкой блокировок вкладок.
            </p>
          </section>
        </div>
      );
    }
    if (phase.kind === 'waiting') {
      return (
        <div className="app-shell">
          <header className="topbar">
            <div className="brand">МедКвадрат</div>
          </header>
          <section className="panel stack">
            <h1 className="heading-flush">Личный кабинет открыт в другой вкладке</h1>
            <p className="muted">Закройте её — кабинет откроется здесь</p>
          </section>
        </div>
      );
    }
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">МедКвадрат</div>
        </header>
        <p className="muted">Открываем кабинет…</p>
      </div>
    );
  }

  const showPatientData = phase.kind === 'cabinet' && canDisplayPatientData();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">МедКвадрат</div>
        {showPatientData ? (
          <button type="button" className="btn ghost" onClick={() => void doLogout()}>
            Выйти
          </button>
        ) : null}
      </header>

      {showPatientData ? (
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
              className={phase.kind === 'cabinet' && phase.tab === id ? 'active' : ''}
              onClick={() => {
                cabinetTab.current = id;
                setPhase({ kind: 'cabinet', tab: id });
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      ) : null}

      {phase.kind === 'boot' ? <p className="muted">Открываем кабинет…</p> : null}
      {phase.kind === 'checking' ? (
        <section className="panel stack">
          <h1 className="heading-flush">Проверяем сессию…</h1>
          <p className="muted">Подождите, обновляем доступ к кабинету.</p>
        </section>
      ) : null}

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

      {showPatientData && phase.tab === 'appointments' ? (
        <AppointmentsScreen clinicPhone={clinicPhone} />
      ) : null}
      {showPatientData && phase.tab === 'history' ? <HistoryScreen /> : null}
      {showPatientData && phase.tab === 'profile' ? <ProfileScreen /> : null}

      {showPatientData ? (
        <div className="footer-logout">
          <button type="button" className="btn ghost" onClick={() => void doLogout()}>
            Выйти
          </button>
        </div>
      ) : null}
    </div>
  );
}
