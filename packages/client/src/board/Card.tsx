import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card, Member, Peer } from '@tandem/shared';
import { Avatar } from '../components/Avatar';
import { DueBadge } from './DueBadge';

interface CardFaceProps {
  card: Card;
  assignee?: Member;
  /** Someone else who has this card open or is dragging it. */
  editor?: Peer;
}

/** What a card looks like. Used in the column and as the picture that follows the pointer while dragging. */
export function CardFace({ card, assignee, editor }: CardFaceProps) {
  return (
    <>
      {card.labels.length > 0 && (
        <span className="card-labels">
          {card.labels.map((label) => (
            <i key={label} style={{ background: `var(--label-${label})` }} title={label} />
          ))}
        </span>
      )}
      <span className="card-title">{card.title}</span>
      {(card.description || card.dueDate || assignee) && (
        <span className="card-meta">
          {card.description && (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-label="Has a description" role="img">
              <path d="M2 4h12M2 8h12M2 12h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
          {card.dueDate && <DueBadge date={card.dueDate} />}
          {assignee &&<Avatar name={assignee.name} color={assignee.color} size={22} />}
        </span>
      )}
      {editor && (
        <span className="card-editor" style={{ background: editor.color }}>
          {editor.name}
        </span>
      )}
    </>
  );
}

export function SortableCard({ card, assignee, editor, onOpen }: CardFaceProps & { onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card' },
  });

  return (
    <div
      ref={setNodeRef}
      className={`card${isDragging ? ' is-dragging' : ''}${editor ? ' is-edited' : ''}`}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        ...(editor ? { outlineColor: editor.color } : {}),
      }}
      data-card-id={card.id}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen(card.id);
        else listeners?.onKeyDown?.(event);
      }}
    >
      <CardFace card={card} assignee={assignee} editor={editor} />
    </div>
  );
}
