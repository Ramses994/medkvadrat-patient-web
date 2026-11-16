import { useCallback, useEffect, useState } from 'react';
import {
  configureSessionHooks,
  loadRuntimeConfig,
  logoutSession,
  quietBootstrap,
  refreshSession,
} from './api/client';
import type { PatientCandidate } from './api/types';
import { AppointmentsScreen } from './screens/AppointmentsScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { LoginScreen } from './screens/LoginScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SelectProfileScreen } from './screens/SelectProfileScreen';
import { startIdleWatch } from './session/idle';
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

  const goLogin = useCallback(() => {
    clearAccessToken();
    setPhase({ kind: 'login' });
  }, []);

  const enterCabinet = useCallback((access: string) => {
    setAccessToken(access);
    setPhase({ kind: 'cabinet', tab: 'appointments' });
  }, []);

  const doLogout = useCallback(async () => {
    // Drop the access token first so no /api/me/* runs after idle/resume logout.
    clearAccessToken();
    try {
      await logoutSession();
    } catch {
      // still leave the screen
    }
    goLogin();
  }, [goLogin]);

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
      onSessionLost: goLogin,
    });
  }, [goLogin]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = await loadRuntimeConfig();
      if (!cancelled) setClinicPhone(cfg.clinic_phone || '');
      const ok = await quietBootstrap();
      if (cancelled) return;
      if (ok) setPhase({ kind: 'cabinet', tab: 'appointments' });
      else setPhase({ kind: 'login' });
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
          onBack={goLogin}
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
