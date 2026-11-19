/** Russian month names in genitive (для «13 октября»). */
const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

/**
 * Parse API wall-clock strings as text — no browser timezone conversion.
 * Appointment: `YYYY-MM-DD HH:MM` → «13 октября 2026, 16:40»
 * Birth date: `YYYY-MM-DD` → «1 января 2000»
 */
function parseYmd(raw: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function formatRuDayMonthYear(y: number, m: number, d: number): string {
  return `${d} ${MONTHS_GENITIVE[m - 1]} ${y}`;
}

/** `YYYY-MM-DD HH:MM` (already Moscow wall time from API) → Russian appointment label. */
export function formatAppointmentWhen(startsAt: string): string {
  const trimmed = startsAt.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
  if (!m) return startsAt;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = m[4];
  const mm = m[5];
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return startsAt;
  return `${formatRuDayMonthYear(y, mo, d)}, ${hh}:${mm}`;
}

/** `YYYY-MM-DD` → Russian birth date, or original string if unparseable. */
export function formatBirthDate(birthDate: string): string {
  const parts = parseYmd(birthDate);
  if (!parts) return birthDate;
  return formatRuDayMonthYear(parts.y, parts.m, parts.d);
}
