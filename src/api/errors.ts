/** Patient-facing texts by API error_details.code. Never show raw codes or messages. */
export function errorText(code: string | undefined, status?: number): string {
  switch (code) {
    case 'OTP_INVALID':
      return 'Неверный код';
    case 'OTP_EXPIRED':
    case 'OTP_ATTEMPTS_EXCEEDED':
      return 'Запросите новый код';
    case 'RATE_LIMITED':
      return 'Попробуйте позже';
    case 'PILOT_ONLY':
      return 'Личный кабинет пока открыт в тестовом режиме';
    case 'VALIDATION':
      return 'Проверьте введённые данные';
    default:
      break;
  }
  if (status !== undefined && (status === 0 || status >= 500)) {
    return 'Сервис временно недоступен';
  }
  if (status === 401 || code === 'UNAUTHORIZED') {
    return 'Сессия истекла. Войдите снова';
  }
  return 'Сервис временно недоступен';
}

export function isRetryable(code: string | undefined, status?: number): boolean {
  if (status !== undefined && (status === 0 || status >= 500)) return true;
  return !code || code === 'INTERNAL';
}
