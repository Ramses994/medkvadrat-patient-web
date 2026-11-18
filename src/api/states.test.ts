import { describe, expect, it } from 'vitest';
import { appointmentStateText, confirmationText } from './states';

describe('appointmentStateText', () => {
  it('maps known states', () => {
    expect(appointmentStateText('scheduled')).toBe('Вы записаны');
    expect(appointmentStateText('waitlist')).toBe('Лист ожидания — время уточнит регистратура');
    expect(appointmentStateText('attended')).toBe('Отмечен приход');
    expect(appointmentStateText('warned_absent')).toBe('Вы предупредили, что не придёте');
    expect(appointmentStateText('not_marked')).toBe('');
  });

  it('returns empty for unknown values without throwing', () => {
    expect(appointmentStateText('weird')).toBe('');
    expect(appointmentStateText(null)).toBe('');
    expect(appointmentStateText(undefined)).toBe('');
  });
});

describe('confirmationText', () => {
  it('maps overlay values', () => {
    expect(confirmationText('confirmed')).toBe('Вы подтвердили визит');
    expect(confirmationText('declined')).toBe('Вы отметили, что не придёте');
    expect(confirmationText(null)).toBe('');
  });
});
