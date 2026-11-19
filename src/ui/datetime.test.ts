import { describe, expect, it } from 'vitest';
import { formatAppointmentWhen, formatBirthDate } from './datetime';

describe('formatAppointmentWhen', () => {
  it('formats API wall time without timezone conversion', () => {
    expect(formatAppointmentWhen('2026-10-13 16:40')).toBe('13 октября 2026, 16:40');
  });

  it('keeps leading day without zero-pad', () => {
    expect(formatAppointmentWhen('2099-06-26 19:30')).toBe('26 июня 2099, 19:30');
  });

  it('returns original string when unparseable', () => {
    expect(formatAppointmentWhen('not-a-date')).toBe('not-a-date');
  });
});

describe('formatBirthDate', () => {
  it('formats birth date in Russian', () => {
    expect(formatBirthDate('2000-01-01')).toBe('1 января 2000');
  });

  it('formats mid-month dates', () => {
    expect(formatBirthDate('1990-05-15')).toBe('15 мая 1990');
  });
});
