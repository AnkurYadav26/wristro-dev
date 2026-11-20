import { formatStamp } from '../format';

/**
 * Step-by-step delivery checklist for one product line.
 * `steps` comes straight from the API: each has { status, label, done, at, note }.
 * Completed checkpoints show a green tick with the time it happened; the rest stay inactive.
 */
export default function TrackingTimeline({ steps = [] }) {
  if (!steps.length) return null;

  return (
    <ol className="timeline">
      {steps.map((step) => (
        <li key={step.status} className={step.done ? 'timeline-step done' : 'timeline-step'}>
          <span className="timeline-marker" aria-hidden="true">{step.done ? '✓' : ''}</span>
          <div className="timeline-body">
            <span className="timeline-label">{step.label}</span>
            <span className="timeline-time">{step.done ? (step.at ? formatStamp(step.at) : 'Completed') : 'Pending'}</span>
            {step.note ? <span className="timeline-note">{step.note}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
