import { useId } from 'react';
import { dueDateSchema, type Card } from '@tandem/shared';
import { useBoard } from './store';
import './due-date.css';

/** Sets or removes a card's due date from the card dialog. */
export function DueDateField({ card }: { card: Card }) {
  const dispatch = useBoard((state) => state.dispatch);
  const inputId = useId();

  const setDueDate = (dueDate: string | null) => {
    if (dueDate === card.dueDate) return;
    dispatch({ type: 'card.update', id: card.id, patch: { dueDate } });
  };

  return (
    <div className="field">
      <label htmlFor={inputId}>Due date</label>
      <div className="due-date-row">
        <input
          id={inputId}
          type="date"
          value={card.dueDate ?? ''}
          onChange={(event) => {
            const { value } = event.target;
            // A cleared input means no due date. A half-typed one is ignored.
            if (value === '') setDueDate(null);
            else if (dueDateSchema.safeParse(value).success) setDueDate(value);
          }}
        />
        {card.dueDate && (
          <button type="button" className="button button-quiet" onClick={() => setDueDate(null)}>
            Remove due date
          </button>
        )}
      </div>
    </div>
  );
}
