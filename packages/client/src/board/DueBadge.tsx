import { dueStatus, formatDueDate, useToday } from './dueDate';
import './due-date.css';

const STATUS_TEXT = { overdue: 'overdue', soon: 'due soon', later: '' } as const;

/** The due date on the face of a card, highlighted when it is overdue or close. */
export function DueBadge({ date }: { date: string }) {
  const today = useToday();
  const status = dueStatus(date, today);
  const text = `Due ${formatDueDate(date, today)}`;
  const label = STATUS_TEXT[status] ? `${text}, ${STATUS_TEXT[status]}` : text;
  return (
    <span className={`due-badge due-${status}`} title={label} aria-label={label}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <rect x="1" y="2" width="10" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M1 5h10M4 1v2M8 1v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      {text}
    </span>
  );
}
