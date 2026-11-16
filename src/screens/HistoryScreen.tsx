import { useCallback, useEffect, useState } from 'react';
import { ApiError, getVisits } from '../api/client';
import type { Appointment } from '../api/types';
import { AppointmentCard } from '../ui/AppointmentCard';
import { ErrorBox } from '../ui/ErrorBox';

function moscowToday(): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(new Date()).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addYears(d: Date, years: number): Date {
  const n = new Date(d.getTime());
  n.setUTCFullYear(n.getUTCFullYear() + years);
  return n;
}

export function HistoryScreen() {
  const [years, setYears] = useState(1);
  const [items, setItems] = useState<Appointment[] | null>(null);
  const [err, setErr] = useState<{ code?: string; status?: number } | null>(null);

  const load = useCallback(async (span: number) => {
    setErr(null);
    const to = moscowToday();
    const from = addYears(to, -span);
    try {
      const rows = await getVisits(ymd(from), ymd(to));
      setItems(rows);
    } catch (e) {
      const ae = e instanceof ApiError ? e : new ApiError('NETWORK', 0, true);
      setErr({ code: ae.code, status: ae.status });
    }
  }, []);

  useEffect(() => {
    void load(years);
  }, [load, years]);

  if (err) {
    return <ErrorBox code={err.code} status={err.status} onRetry={() => void load(years)} />;
  }
  if (!items) {
    return <p className="muted">Загружаем историю…</p>;
  }

  return (
    <section className="stack">
      <h2 className="heading-flush">История</h2>
      {items.length === 0 ? <p className="muted">Посещений за выбранный период нет</p> : null}
      {items.map((item) => (
        <AppointmentCard key={item.planning_id} item={item} />
      ))}
      {years < 3 ? (
        <button
          type="button"
          className="btn"
          onClick={() => setYears((y) => Math.min(3, y + 1))}
        >
          Показать ещё год
        </button>
      ) : null}
    </section>
  );
}
