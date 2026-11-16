import { useCallback, useEffect, useState } from 'react';
import {
  configureSessionHooks,
  loadRuntimeConfig,
  logoutSession,
  quietBootstrap,
  refreshSession,
  resetSharedRefresh,
} from './api/client';
import type { PatientCandidate } from './api/types';
import { AppointmentsScreen } from './screens/AppointmentsScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { LoginScreen } from './screens/LoginScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SelectProfileScreen } from './screens/SelectProfileScreen';
import { startIdleWatch } from './session/idle';
import {
  advanceSession,
  broadcastTab,
  ensureTabChannel,
  getGeneration,
  getServerSession,
  isCurrentGeneration,
  isSessionChangedError,
  setServerSession,
  trackLogoutNetwork,
} from './session/sessionGate';
import { clearAccessToken, setAccessToken } from './session/tokenStore';

type Tab = 'appointments' | 'history' | 'profile';
type Phase =
  | { kind: 'boot' }
  | { kind: 'login' }
  | { kind: 'select'; requestId: string; candidates: PatientCandidate[] }
  | { kind: 'cabinet'; tab: Tab };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'boot' });
  const [clinicPhone, setClinicPhone] = useState('');

  const showLogin = useCallback(() => {
    setPhase({ kind: 'login' });
  }, []);

  /** Local clear only — no server logout (cross-tab / SESSION_CHANGED). */
  const endLocalSession = useCallback(() => {
    advanceSession();
    resetSharedRefresh();
    clearAccessToken();
    setServerSession(null);
    showLogin();
  }, [showLogin]);

  const doLogout = useCallback(
    async (opts: { fromBroadcast?: boolean } = {}) => {
      const session = getServerSession() ?? undefined;
      endLocalSession();
      if (opts.fromBroadcast) return;
      broadcastTab({ type: 'logout', session });
      // Keepalive logout outside shared AbortController; never cancelled by local clear.
      await trackLogoutNetwork(() => logoutSession());
    },
    [endLocalSession],
  );

  const enterCabinet = useCallback(
    (access: string, session?: string) => {
      advanceSession();
      resetSharedRefresh();
      setAccessToken(access);
      if (session) setServerSession(session);
      broadcastTab({ type: 'login', session: session ?? getServerSession() ?? undefined });
      setPhase({ kind: 'cabinet', tab: 'appointments' });
    },
    [],
  );

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
        // 409 SESSION_CHANGED → clear and login; do NOT send logout.
        endLocalSession();
      },
    });
  }, [doLogout, endLocalSession]);

  useEffect(() => {
    return ensureTabChannel((msg) => {
      if (msg.type === 'logout') {
        endLocalSession();
        return;
      }
      if (msg.type === 'login') {
        const mine = getServerSession();
        if (msg.session && mine && msg.session === mine) return;
        endLocalSession();
      }
    });
  }, [endLocalSession]);

  useEffect(() => {
    const bootGen = getGeneration();
    (async () => {
      const cfg = await loadRuntimeConfig();
      if (!isCurrentGeneration(bootGen)) return;
      setClinicPhone(cfg.clinic_phone || '');
      const ok = await quietBootstrap();
      if (!isCurrentGeneration(bootGen)) return;
      if (ok) {
        setPhase({ kind: 'cabinet', tab: 'appointments' });
      } else {
        setPhase({ kind: 'login' });
      }
    })();
  }, []);

  useEffect(() => {
    if (phase.kind !== 'cabinet') return;
    return startIdleWatch(() => {
      void doLogout();
    });
  }, [phase.kind, doLogout]);

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
          onTokens={(access, session) => enterCabinet(access, session)}
          onCandidates={(requestId, candidates) =>
            setPhase({ kind: 'select', requestId, candidates })
          }
        />
      ) : null}

      {phase.kind === 'select' ? (
        <SelectProfileScreen
          requestId={phase.requestId}
          candidates={phase.candidates}
          onTokens={(access, session) => enterCabinet(access, session)}
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
