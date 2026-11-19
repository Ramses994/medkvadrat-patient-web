import type { Appointment } from '../api/types';
import { appointmentStateText, confirmationText } from '../api/states';
import { formatAppointmentWhen } from './datetime';

export function AppointmentCard({ item }: { item: Appointment }) {
  const state = appointmentStateText(item.state);
  const confirmation = confirmationText(item.confirmation);
  const branch = item.branch
    ? [item.branch.name, item.branch.address].filter(Boolean).join(', ')
    : '';

  return (
    <article className="card">
      <h3>{formatAppointmentWhen(item.starts_at)}</h3>
      {item.doctor?.name ? <div>{item.doctor.name}</div> : null}
      {item.exam_name ? <div className="muted">{item.exam_name}</div> : null}
      {branch ? <div className="muted">{branch}</div> : null}
      {state ? <span className="badge">{state}</span> : null}
      {confirmation ? <span className="badge warn">{confirmation}</span> : null}
    </article>
  );
}
