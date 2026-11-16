/** Appointment state labels for the patient. Unknown values → empty (never throw). */
export function appointmentStateText(state: string | undefined | null): string {
  switch (state) {
    case 'scheduled':
      return 'Вы записаны';
    case 'waitlist':
      return 'Лист ожидания — время уточнит регистратура';
    case 'attended':
      return 'Отмечен приход';
    case 'warned_absent':
      return 'Вы предупредили, что не придёте';
    case 'not_marked':
      return '';
    default:
      return '';
  }
}

export function confirmationText(value: string | undefined | null): string {
  switch (value) {
    case 'confirmed':
      return 'Вы подтвердили визит';
    case 'declined':
      return 'Вы отметили, что не придёте';
    default:
      return '';
  }
}
