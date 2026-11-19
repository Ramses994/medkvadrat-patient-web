import { describe, expect, it } from 'vitest';
import { otpCodeHint } from './otpDelivery';

describe('otpCodeHint', () => {
  it('uses email wording for email delivery', () => {
    expect(otpCodeHint('email')).toBe('Код отправлен на e-mail из карточки');
  });

  it('uses pilot wording for pilot delivery', () => {
    expect(otpCodeHint('pilot')).toBe(
      'Тестовый режим: введите код, который выдал администратор пилота',
    );
  });

  it('falls back to neutral text for unknown delivery', () => {
    expect(otpCodeHint(undefined)).toBe('Введите код');
    expect(otpCodeHint('sms')).toBe('Введите код');
  });
});
