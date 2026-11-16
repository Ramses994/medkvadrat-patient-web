import { useCallback, useEffect, useRef, useState } from 'react';
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
  LOGOUT_CHANNEL,
  LOGOUT_TIMEOUT_MS,
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
  const skippingServerLogout = useRef(false);

  const showLogin = useCallback(() => {
    setPhase({ kind: 'login' });
  }, []);

  /** У2: clear local session first; optionally skip the server logout (cross-tab). */
  const endLocalSession = useCallback(() => {
    advanceSession();
    resetSharedRefresh();
    clearAccessToken();
    showLogin();
  }, [showLogin]);

  const broadcastLogout = useCallback(() => {
    try {
      const ch = new BroadcastChannel(LOGOUT_CHANNEL);
      ch.postMessage('logout');
      ch.close();
    } catch {
      // BroadcastChannel unavailable — single-tab only.
    }
  }, []);

  const doLogout = useCallback(
    async (opts: { fromBroadcast?: boolean } = {}) => {
      endLocalSession();
      if (opts.fromBroadcast || skippingServerLogout.current) return;
      broadcastLogout();
      const ac = new AbortController();
      const timer = window.setTimeout(() => ac.abort(), LOGOUT_TIMEOUT_MS);
      await trackLogoutNetwork(async () => {
        try {
          await logoutSession(ac.signal);
        } catch {
          // Late or failed logout is discarded (У1 / У2).
        } finally {
          window.clearTimeout(timer);
        }
      });
    },
    [broadcastLogout, endLocalSession],
  );

  const enterCabinet = useCallback((access: string) => {
    advanceSession();
    resetSharedRefresh();
    setAccessToken(access);
    setPhase({ kind: 'cabinet', tab: 'appointments' });
  }, []);

  useEffect(() => {
    configureSessionHooks({
      refresh: async () => {
        try {
          await refreshSession();
          return true;
        } catch {
          return false;
        }
      },
      onSessionLost: () => {
        // У2 for session loss: clear UI, then best-effort server logout.
        void doLogout();
      },
    });
  }, [doLogout]);

  useEffect(() => {
    let ch: BroadcastChannel;
    try {
      ch = new BroadcastChannel(LOGOUT_CHANNEL);
    } catch {
      return;
    }
    ch.onmessage = () => {
      skippingServerLogout.current = true;
      void doLogout({ fromBroadcast: true }).finally(() => {
        skippingServerLogout.current = false;
      });
    };
    return () => ch.close();
  }, [doLogout]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = await loadRuntimeConfig();
      if (!cancelled) setClinicPhone(cfg.clinic_phone || '');
      const ok = await quietBootstrap();
      if (cancelled) return;
      if (ok) {
        advanceSession();
        setPhase({ kind: 'cabinet', tab: 'appointments' });
      } else setPhase({ kind: 'login' });
    })();
    return () => {
      cancelled = true;
    };
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
          onTokens={enterCabinet}
          onCandidates={(requestId, candidates) =>
            setPhase({ kind: 'select', requestId, candidates })
          }
        />
      ) : null}

      {phase.kind === 'select' ? (
        <SelectProfileScreen
          requestId={phase.requestId}
          candidates={phase.candidates}
          onTokens={enterCabinet}
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
