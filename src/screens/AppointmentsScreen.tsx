import { useCallback, useEffect, useState } from 'react';
import { ApiError, getAppointments } from '../api/client';
import type { Appointment } from '../api/types';
import { isStaleSessionError } from '../session/sessionGate';
import { AppointmentCard } from '../ui/AppointmentCard';
import { ErrorBox } from '../ui/ErrorBox';

type Props = {
  clinicPhone: string;
};

export function AppointmentsScreen({ clinicPhone }: Props) {
  const [items, setItems] = useState<Appointment[] | null>(null);
  const [err, setErr] = useState<{ code?: string; status?: number } | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const rows = await getAppointments('upcoming');
      setItems(rows);
    } catch (e) {
      if (isStaleSessionError(e)) return;
      const ae = e instanceof ApiError ? e : new ApiError('NETWORK', 0, true);
      setErr({ code: ae.code, status: ae.status });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (err) {
    return <ErrorBox code={err.code} status={err.status} onRetry={() => void load()} />;
  }
  if (!items) {
    return <p className="muted">Загружаем записи…</p>;
  }
  if (items.length === 0) {
    return (
      <section className="panel empty stack">
        <h2 className="heading-flush">Предстоящих записей нет</h2>
        {clinicPhone ? (
          <p className="muted">
            По вопросам записи позвоните в клинику:{' '}
            <a href={`tel:${clinicPhone.replace(/[^\d+]/g, '')}`}>{clinicPhone}</a>
          </p>
        ) : (
          <p className="muted">По вопросам записи обратитесь в регистратуру.</p>
        )}
      </section>
    );
  }

  return (
    <section className="stack">
      <h2 className="heading-flush">Мои записи</h2>
      {items.map((item) => (
        <AppointmentCard key={item.planning_id} item={item} />
      ))}
    </section>
  );
}
