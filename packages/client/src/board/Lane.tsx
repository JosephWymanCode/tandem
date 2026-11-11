import { useState, type KeyboardEvent } from 'react';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { keyBetween, type BoardState, type Column, type Member, type Peer } from '@tandem/shared';
import { CardFace, SortableCard } from './Card';
import { useBoard } from './store';

interface LaneProps {
  column: Column;
  cardIds: string[];
  board: BoardState;
  members: Member[];
  editors: Record<string, Peer>;
  onOpenCard: (id: string) => void;
}

function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      {[3, 7, 11].map((y) => (
        <g key={y} fill="currentColor">
          <circle cx="4.5" cy={y} r="1.2" />
          <circle cx="9.5" cy={y} r="1.2" />
        </g>
      ))}
    </svg>
  );
}

function AddCard({ column, lastPos }: { column: Column; lastPos: string | null }) {
  const dispatch = useBoard((state) => state.dispatch);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');

  const add = () => {
    if (!title.trim()) return;
    dispatch({
      type: 'card.add',
      id: crypto.randomUUID(),
      columnId: column.id,
      title: title.trim().slice(0, 120),
      pos: keyBetween(lastPos, null),
    });
    setTitle('');
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      add();
    } else if (event.key === 'Escape') {
      setOpen(false);
      setTitle('');
    }
  };

  if (!open) {
    return (
      <button className="lane-add" onClick={() => setOpen(true)}>
        Add a card
      </button>
    );
  }
  return (
    <div className="composer">
      <textarea
        autoFocus
        rows={2}
        value={title}
        maxLength={120}
        placeholder="What needs doing?"
        aria-label={`New card in ${column.title}`}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!title.trim()) setOpen(false);
        }}
      />
      <div className="composer-actions">
        <button className="button button-primary" onClick={add} disabled={!title.trim()}>
          Add card
        </button>
        <button
          className="button button-quiet"
          onClick={() => {
            setOpen(false);
            setTitle('');
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function Lane({ column, cardIds, board, members, editors, onOpenCard }: LaneProps) {
  const dispatch = useBoard((state) => state.dispatch);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: 'column' },
  });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const saveTitle = () => {
    const next = renaming?.trim();
    if (next && next !== column.title) dispatch({ type: 'column.rename', id: column.id, title: next });
    setRenaming(null);
  };

  const lastCard = cardIds.length > 0 ? board.cards[cardIds[cardIds.length - 1]!] : undefined;

  return (
    <section
      ref={setNodeRef}
      className={`lane${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-label={column.title}
      data-column-id={column.id}
    >
      <header className="lane-head">
        <button className="lane-grip" aria-label={`Move column ${column.title}`} {...attributes} {...listeners}>
          <GripIcon />
        </button>
        {renaming === null ? (
          <h2>
            <button className="lane-title" onClick={() => setRenaming(column.title)} title="Rename column">
              {column.title}
            </button>
          </h2>
        ) : (
          <input
            className="lane-title-input"
            autoFocus
            value={renaming}
            maxLength={120}
            aria-label="Column name"
            onChange={(event) => setRenaming(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveTitle();
              if (event.key === 'Escape') setRenaming(null);
            }}
          />
        )}
        <span className="lane-count" aria-label={`${cardIds.length} cards`}>
          {cardIds.length}
        </span>
        <button
          className="lane-delete"
          aria-label={`Delete column ${column.title}`}
          title="Delete column"
          onClick={() => setConfirming(true)}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {confirming && (
        <div className="lane-confirm" role="alertdialog" aria-label="Delete column">
          <p>
            {cardIds.length === 0
              ? 'Delete this column?'
              : `Delete this column and its ${cardIds.length} card${cardIds.length === 1 ? '' : 's'}?`}
          </p>
          <button className="button button-danger" onClick={() => dispatch({ type: 'column.delete', id: column.id })}>
            Delete column
          </button>
          <button className="button button-quiet" onClick={() => setConfirming(false)}>
            Keep it
          </button>
        </div>
      )}

      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <div className="lane-cards">
          {cardIds.map((id) => {
            const card = board.cards[id];
            if (!card) return null;
            return (
              <SortableCard
                key={id}
                card={card}
                assignee={members.find((member) => member.id === card.assigneeId)}
                editor={editors[id]}
                onOpen={onOpenCard}
              />
            );
          })}
        </div>
      </SortableContext>

      <AddCard column={column} lastPos={lastCard?.pos ?? null} />
    </section>
  );
}

/** The picture of a column that follows the pointer while it is dragged. */
export function LaneGhost({ column, cardIds, board }: Pick<LaneProps, 'column' | 'cardIds' | 'board'>) {
  return (
    <section className="lane lane-ghost">
      <header className="lane-head">
        <span className="lane-grip">
          <GripIcon />
        </span>
        <h2>
          <span className="lane-title">{column.title}</span>
        </h2>
        <span className="lane-count">{cardIds.length}</span>
      </header>
      <div className="lane-cards">
        {cardIds.slice(0, 6).map((id) => {
          const card = board.cards[id];
          return card ? (
            <div className="card" key={id}>
              <CardFace card={card} />
            </div>
          ) : null;
        })}
      </div>
    </section>
  );
}
