import { useState } from 'react';
import { ApiError, selectPatient } from '../api/client';
import type { PatientCandidate } from '../api/types';
import { ErrorBox } from '../ui/ErrorBox';

type Props = {
  requestId: string;
  candidates: PatientCandidate[];
  onTokens: (access: string) => void;
  onBack: () => void;
};

export function SelectProfileScreen({ requestId, candidates, onTokens, onBack }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ code?: string; status?: number } | null>(null);

  async function choose(id: number) {
    setErr(null);
    setBusy(true);
    try {
      const tok = await selectPatient(requestId, id);
      onTokens(tok.access);
    } catch (e) {
      const ae = e instanceof ApiError ? e : new ApiError('NETWORK', 0, true);
      setErr({ code: ae.code, status: ae.status });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel stack">
      <h1 className="heading-flush">Выберите профиль</h1>
      <p className="muted">На этом номере несколько карточек. Выберите свою.</p>
      {candidates.map((c) => (
        <button
          key={c.patient_id}
          type="button"
          className="btn profile-choice"
          disabled={busy}
          onClick={() => void choose(c.patient_id)}
        >
          <strong>{c.full_name}</strong>
          {c.masked_email ? <div className="muted">{c.masked_email}</div> : null}
        </button>
      ))}
      <button type="button" className="btn ghost" disabled={busy} onClick={onBack}>
        Назад
      </button>
      {err ? <ErrorBox code={err.code} status={err.status} /> : null}
    </section>
  );
}
