import { useEffect, useRef, useState } from 'react';
import { LABELS, type Card, type Label, type Member, type Peer } from '@tandem/shared';
import { useBoard } from './store';
import { DueDateField } from './DueDateField';
import { CommentThread } from './CommentThread';

const LABEL_NAMES: Record<Label, string> = {
  red: 'Red',
  amber: 'Amber',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  violet: 'Violet',
};

export function CardDialog({
  card,
  columnTitle,
  members,
  others,
  onClose,
}: {
  card: Card;
  columnTitle: string;
  members: Member[];
  /** Other people who have this same card open. */
  others: Peer[];
  onClose: () => void;
}) {
  const dispatch = useBoard((state) => state.dispatch);
  const setEditing = useBoard((state) => state.setEditing);
  const dialog = useRef<HTMLDialogElement>(null);
  // A draft is null until the field is touched, so other people's edits show
  // up live in any field this person is not in the middle of changing.
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    setEditing(card.id);
    return () => setEditing(null);
  }, [card.id, setEditing]);

  const saveTitle = () => {
    const next = title?.trim();
    if (next && next !== card.title) dispatch({ type: 'card.update', id: card.id, patch: { title: next } });
    setTitle(null);
  };

  const saveDescription = () => {
    if (description !== null && description !== card.description) {
      dispatch({ type: 'card.update', id: card.id, patch: { description } });
    }
    setDescription(null);
  };

  const toggleLabel = (label: Label) => {
    const labels = card.labels.includes(label) ? card.labels.filter((l) => l !== label) : [...card.labels, label];
    dispatch({ type: 'card.update', id: card.id, patch: { labels } });
  };

  const close = () => {
    saveTitle();
    saveDescription();
    onClose();
  };

  return (
    <dialog
      ref={dialog}
      className="dialog card-dialog"
      aria-labelledby="card-dialog-title"
      onClose={close}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === dialog.current) dialog.current?.close();
      }}
    >
      <div className="dialog-body">
        <p className="dialog-context" id="card-dialog-title">
          Card in {columnTitle}
        </p>
        {others.length > 0 && (
          <p className="dialog-others">
            {others.map((peer) => (
              <span key={peer.connId} style={{ background: peer.color }}>
                {peer.name}
              </span>
            ))}
            {others.length === 1 ? 'is' : 'are'} looking at this card too
          </p>
        )}

        <label className="field">
          Title
          <input
            value={title ?? card.title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </label>

        <label className="field">
          Description
          <textarea
            rows={5}
            value={description ?? card.description}
            maxLength={4000}
            placeholder="Add the details someone picking this up would need."
            onChange={(event) => setDescription(event.target.value)}
            onBlur={saveDescription}
          />
        </label>

        <fieldset className="field">
          <legend>Labels</legend>
          <div className="label-picker">
            {LABELS.map((label) => (
              <button
                key={label}
                type="button"
                aria-pressed={card.labels.includes(label)}
                style={{ ['--swatch' as string]: `var(--label-${label})` }}
                onClick={() => toggleLabel(label)}
              >
                <i />
                {LABEL_NAMES[label]}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field">
          Assigned to
          <select
            value={card.assigneeId ?? ''}
            onChange={(event) =>
              dispatch({ type: 'card.update', id: card.id, patch: { assigneeId: event.target.value || null } })
            }
          >
            <option value="">Nobody</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>

        <DueDateField card={card} />

        <CommentThread cardId={card.id} />

        <div className="dialog-actions">
          {confirming ? (
            <span className="confirm">
              Delete for everyone?
              <button
                className="button button-danger"
                onClick={() => {
                  dispatch({ type: 'card.delete', id: card.id });
                  onClose();
                }}
              >
                Delete card
              </button>
              <button className="button button-quiet" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </span>
          ) : (
            <button className="button button-quiet" onClick={() => setConfirming(true)}>
              Delete card
            </button>
          )}
          <button className="button button-dark" onClick={() => dialog.current?.close()}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
