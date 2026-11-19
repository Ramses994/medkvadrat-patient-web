/** Patient-facing OTP code hint from API `delivery` (А4). */
export function otpCodeHint(delivery: string | undefined): string {
  if (delivery === 'email') return 'Код отправлен на e-mail из карточки';
  if (delivery === 'pilot') {
    return 'Тестовый режим: введите код, который выдал администратор пилота';
  }
  return 'Введите код';
}
