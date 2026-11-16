import { useCallback, useEffect, useState } from 'react';
import { ApiError, getProfile } from '../api/client';
import type { Profile } from '../api/types';
import { ErrorBox } from '../ui/ErrorBox';

export function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [err, setErr] = useState<{ code?: string; status?: number } | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setProfile(await getProfile());
    } catch (e) {
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
  if (!profile) {
    return <p className="muted">Загружаем профиль…</p>;
  }

  const birth = profile.birth_date
    ? profile.birth_date
    : profile.birth_year
      ? String(profile.birth_year)
      : '—';

  return (
    <section className="panel stack">
      <h2 className="heading-flush">Профиль</h2>
      <div>
        <div className="muted">ФИО</div>
        <div>{profile.full_name}</div>
      </div>
      <div>
        <div className="muted">Дата рождения</div>
        <div>{birth}</div>
      </div>
      <div>
        <div className="muted">Телефон</div>
        <div>{profile.phone || '—'}</div>
      </div>
      <div>
        <div className="muted">E-mail</div>
        <div>{profile.email || '—'}</div>
      </div>
    </section>
  );
}
