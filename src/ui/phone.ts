/** Keep only digits; Russian numbers as 10 digits without leading 7/8. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/** Normalize to API form +7XXXXXXXXXX or empty if incomplete. */
export function toApiPhone(input: string): string {
  let d = digitsOnly(input);
  if (d.startsWith('8')) d = `7${d.slice(1)}`;
  if (d.startsWith('7')) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length !== 10) return '';
  return `+7${d}`;
}

/** Display mask +7 XXX XXX-XX-XX while typing. */
export function formatPhoneMask(input: string): string {
  let d = digitsOnly(input);
  if (d.startsWith('8')) d = `7${d.slice(1)}`;
  if (d.startsWith('7')) d = d.slice(1);
  d = d.slice(0, 10);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 8);
  const p4 = d.slice(8, 10);
  let out = '+7';
  if (p1) out += ` ${p1}`;
  if (p2) out += ` ${p2}`;
  if (p3) out += `-${p3}`;
  if (p4) out += `-${p4}`;
  return out;
}

/** Login code: digits and Latin letters, up to 64 (pilot codes are long). */
export function sanitizeCode(input: string): string {
  return input.replace(/[^0-9A-Za-z]/g, '').slice(0, 64);
}
