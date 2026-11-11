import { useEffect, useId, useRef, useState } from 'react';
import { dueDateSchema, type Card } from '@tandem/shared';
import { useBoard } from './store';
import './due-date.css';

/**
 * Sets or removes a card's due date from the card dialog. Like the title, the
 * date is a draft while it is being typed (a native date input reports every
 * segment, such as the year 0202 on the way to 2027) and is saved on blur,
 * Enter or when the dialog closes.
 */
export function DueDateField({ card }: { card: Card }) {
  const dispatch = useBoard((state) => state.dispatch);
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef<string | null>(null);

  const setDueDate = (dueDate: string | null) => {
    if (dueDate === card.dueDate) return;
    dispatch({ type: 'card.update', id: card.id, patch: { dueDate } });
  };

  const save = () => {
    const value = pending.current;
    pending.current = null;
    setDraft(null);
    if (value === null) return;
    // A cleared input means no due date. A half-typed one is dropped.
    if (value === '') setDueDate(null);
    else if (dueDateSchema.safeParse(value).success) setDueDate(value);
  };

  // Saves a draft left in the field when the dialog closes without a blur (Escape, for example).
  const saveOnUnmount = useRef(save);
  useEffect(() => {
    saveOnUnmount.current = save;
  });
  useEffect(() => () => saveOnUnmount.current(), []);

  return (
    <div className="field">
      <label htmlFor={inputId}>Due date</label>
      <div className="due-date-row">
        <input
          ref={input}
          id={inputId}
          type="date"
          min="1000-01-01"
          max="9999-12-31"
          value={draft ?? card.dueDate ?? ''}
          onChange={(event) => {
            pending.current = event.target.value;
            setDraft(event.target.value);
          }}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              save();
            }
          }}
        />
        {card.dueDate && (
          <button
            type="button"
            className="button button-quiet"
            onClick={() => {
              pending.current = null;
              setDraft(null);
              setDueDate(null);
              // The button goes away, so keep keyboard focus in the dialog.
              input.current?.focus();
            }}
          >
            Remove due date
          </button>
        )}
      </div>
    </div>
  );
}
