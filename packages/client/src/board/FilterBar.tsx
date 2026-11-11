import { useEffect, useRef, useState } from 'react';
import { LABELS, type Member } from '@tandem/shared';
import { isFiltering, useFilter } from './filter';
import './FilterBar.css';

const labelName = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** Search box and filters for the board. What is chosen here only changes this person's view. */
export function FilterBar({ members }: { members: Member[] }) {
  const filter = useFilter();
  const { query, labels, assignee, setQuery, toggleLabel, setAssignee, clear } = filter;
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  // A filter belongs to one visit to one board.
  useEffect(() => clear, [clear]);

  // "/" jumps to the search box, unless the person is typing somewhere or a dialog is open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target) || document.querySelector('dialog[open]')) return;
      // Not while a card or column is being carried with the keyboard: focus must stay on it.
      if (document.querySelector('.card.is-dragging, .lane.is-dragging')) return;
      event.preventDefault();
      search.current?.focus();
      search.current?.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The popover closes when the person clicks or moves focus elsewhere.
  useEffect(() => {
    if (!open) return;
    const onOutside = (event: Event) => {
      if (event.target instanceof Node && !popover.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('focusin', onOutside);
    return () => {
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('focusin', onOutside);
    };
  }, [open]);

  const chosen = labels.length + (assignee === null ? 0 : 1);
  const knownAssignee = assignee === null || assignee === 'none' || members.some((member) => member.id === assignee);

  return (
    <div className="filter-bar" role="search">
      <input
        ref={search}
        className="filter-search"
        type="search"
        value={query}
        maxLength={120}
        placeholder="Search cards"
        aria-label="Search cards"
        aria-keyshortcuts="/"
        title="Press / to search"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          if (query) setQuery('');
          else event.currentTarget.blur();
        }}
      />
      <div
        className="filter-menu"
        ref={popover}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !open) return;
          setOpen(false);
          event.currentTarget.querySelector('button')?.focus();
        }}
      >
        <button
          className="button button-quiet"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-pressed={chosen > 0}
          onClick={() => setOpen((value) => !value)}
        >
          Filter
          {chosen > 0 && (
            <span className="filter-chosen" aria-label={`${chosen} chosen`}>
              {chosen}
            </span>
          )}
        </button>
        {open && (
          <div className="filter-popover" role="dialog" aria-label="Filter cards">
            <fieldset className="field">
              <legend>Labels</legend>
              <div className="label-picker">
                {LABELS.map((label) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={labels.includes(label)}
                    style={{ ['--swatch' as string]: `var(--label-${label})` }}
                    onClick={() => toggleLabel(label)}
                  >
                    <i />
                    {labelName(label)}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="field">
              Assigned to
              <select value={assignee ?? ''} onChange={(event) => setAssignee(event.target.value || null)}>
                <option value="">Anyone</option>
                <option value="none">Nobody</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
                {!knownAssignee && <option value={assignee ?? ''}>Someone who has left</option>}
              </select>
            </label>
          </div>
        )}
      </div>
      {isFiltering(filter) && (
        <button className="button button-quiet" onClick={clear}>
          Clear filters
        </button>
      )}
    </div>
  );
}

/** Shown in place of nothing at all when a filter hides every card on the board. */
export function FilterEmpty() {
  const clear = useFilter((state) => state.clear);
  return (
    <p className="filter-empty" role="status">
      No cards match your search and filters.
      <button className="button button-quiet" onClick={clear}>
        Clear filters
      </button>
    </p>
  );
}
