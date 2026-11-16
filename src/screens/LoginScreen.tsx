import { useEffect, useState } from 'react';
import { ApiError, requestOtp, verifyOtp } from '../api/client';
import type { OtpVerifyResult, PatientCandidate } from '../api/types';
import { isStaleSessionError } from '../session/sessionGate';
import { ErrorBox } from '../ui/ErrorBox';
import { formatPhoneMask, sanitizeCode, toApiPhone } from '../ui/phone';

type Props = {
  onTokens: (access: string) => void;
  onCandidates: (requestId: string, candidates: PatientCandidate[]) => void;
};

const RESEND_SEC = 60;

export function LoginScreen({ onTokens, onCandidates }: Props) {
  const [phone, setPhone] = useState('+7');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ code?: string; status?: number } | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  async function sendCode() {
    setErr(null);
    const apiPhone = toApiPhone(phone);
    if (!apiPhone) {
      setErr({ code: 'VALIDATION' });
      return;
    }
    setBusy(true);
    try {
      const res = await requestOtp(apiPhone);
      setRequestId(res.request_id);
      setMessage(res.message);
      setCooldown(RESEND_SEC);
      setCode('');
    } catch (e) {
      if (isStaleSessionError(e)) return;
      const ae = e instanceof ApiError ? e : new ApiError('NETWORK', 0, true);
      setErr({ code: ae.code, status: ae.status });
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (!requestId || !code) return;
    setErr(null);
    setBusy(true);
    try {
      const res: OtpVerifyResult = await verifyOtp(requestId, code);
      if (res.patient_candidates && res.patient_candidates.length > 0) {
        onCandidates(requestId, res.patient_candidates);
        return;
      }
      if (res.access) {
        onTokens(res.access);
        return;
      }
      setErr({ code: 'INTERNAL', status: 500 });
    } catch (e) {
      if (isStaleSessionError(e)) return;
      const ae = e instanceof ApiError ? e : new ApiError('NETWORK', 0, true);
      setErr({ code: ae.code, status: ae.status });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel stack">
      <h1 className="heading-flush">Вход</h1>
      <p className="muted">Введите номер телефона из карточки клиники. Код придёт на e-mail из карточки.</p>

      <label>
        Телефон
        <input
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(formatPhoneMask(e.target.value))}
          aria-label="Телефон"
        />
      </label>

      <button
        type="button"
        className="btn primary"
        disabled={busy || cooldown > 0 || !toApiPhone(phone)}
        onClick={() => void sendCode()}
      >
        {cooldown > 0 ? `Повтор через ${cooldown} с` : 'Получить код'}
      </button>

      {requestId ? (
        <>
          <p className="hint">{message}</p>
          <label>
            Код
            <input
              inputMode="text"
              autoComplete="one-time-code"
              value={code}
              maxLength={64}
              onChange={(e) => setCode(sanitizeCode(e.target.value))}
              onPaste={(e) => {
                e.preventDefault();
                setCode(sanitizeCode(e.clipboardData.getData('text')));
              }}
              aria-label="Код"
            />
          </label>
          <button
            type="button"
            className="btn primary"
            disabled={busy || code.length === 0}
            onClick={() => void submitCode()}
          >
            Войти
          </button>
        </>
      ) : null}

      {err ? (
        <ErrorBox
          code={err.code}
          status={err.status}
          onRetry={err.status === 0 || (err.status !== undefined && err.status >= 500) ? () => void sendCode() : undefined}
        />
      ) : null}
    </section>
  );
}
