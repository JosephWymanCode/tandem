import { useEffect, useId, useState } from 'react';
import { COMMENT_MAX_LENGTH, type Comment } from '@tandem/shared';
import { ApiError, api } from '../api';
import { useComments } from './comments';
import { relativeTime, useNow } from './relativeTime';
import { useBoard } from './store';
import './comments.css';

/** The comment thread in the card dialog. New comments from anyone show up live. */
export function CommentThread({ cardId }: { cardId: string }) {
  const boardId = useBoard((state) => state.board?.id ?? null);
  const userId = useBoard((state) => state.you?.userId ?? null);
  const isOwner = useBoard((state) =>
    state.members.some((member) => member.id === state.you?.userId && member.role === 'owner'),
  );
  const thread = useComments((state) => state.threads[cardId]);
  const epoch = useComments((state) => state.epoch);
  const now = useNow();
  const headingId = useId();
  const fieldId = useId();

  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch the thread on opening, and again after a reconnection in case
  // anything was missed while the connection was down.
  useEffect(() => {
    if (!boardId) return;
    let settled = false;
    const store = useComments.getState();
    store.loading(cardId);
    api.comments(boardId, cardId).then(
      ({ comments }) => {
        if (settled) return;
        settled = true;
        store.loaded(cardId, comments);
        setError(null);
      },
      (failure: Error) => {
        if (settled) return;
        settled = true;
        store.stopLoading(cardId);
        setError(`Comments could not be loaded. ${failure.message}`);
      },
    );
    return () => {
      if (!settled) store.stopLoading(cardId);
      settled = true;
    };
  }, [boardId, cardId, epoch]);

  const body = draft.trim();

  const post = async () => {
    if (!boardId || !body || posting) return;
    setPosting(true);
    try {
      const { comment } = await api.addComment(boardId, cardId, body);
      useComments.getState().added(comment, false);
      setDraft('');
      setError(null);
    } catch (failure) {
      setError(`Your comment was not posted. ${(failure as Error).message}`);
    } finally {
      setPosting(false);
    }
  };

  const remove = async (comment: Comment) => {
    if (!boardId) return;
    setConfirming(null);
    try {
      await api.deleteComment(boardId, comment.id);
      useComments.getState().removed(cardId, comment.id, false);
      setError(null);
    } catch (failure) {
      // Someone else deleted it first: it is gone either way.
      if (failure instanceof ApiError && failure.status === 404) {
        useComments.getState().removed(cardId, comment.id, false);
        return;
      }
      setError(`The comment was not deleted. ${(failure as Error).message}`);
    }
  };

  let list;
  if (thread === undefined) {
    list = error ? null : <p className="comments-empty">Loading comments…</p>;
  } else if (thread.length === 0) {
    list = <p className="comments-empty">No comments yet. Be the first to add one.</p>;
  } else {
    list = (
      <ol className="comment-list">
        {thread.map((comment) => (
          <li key={comment.id} className="comment">
            <p className="comment-head">
              <span className="comment-author">{comment.authorName}</span>
              <time
                dateTime={new Date(comment.createdAt).toISOString()}
                title={new Date(comment.createdAt).toLocaleString()}
              >
                {relativeTime(comment.createdAt, now)}
              </time>
              {(comment.authorId === userId || isOwner) &&
                (confirming === comment.id ? (
                  <span className="confirm comment-confirm">
                    Delete this comment?
                    <button className="button button-danger" onClick={() => void remove(comment)}>
                      Delete comment
                    </button>
                    <button className="button button-quiet" onClick={() => setConfirming(null)}>
                      Keep it
                    </button>
                  </span>
                ) : (
                  <button
                    className="comment-delete"
                    aria-label={`Delete comment by ${comment.authorName}`}
                    onClick={() => setConfirming(comment.id)}
                  >
                    Delete
                  </button>
                ))}
            </p>
            <p className="comment-body">{comment.body}</p>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <section className="comments" aria-labelledby={headingId}>
      <h3 id={headingId} className="comments-heading">
        Comments
      </h3>

      {list}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <form
        className="comment-form"
        onSubmit={(event) => {
          event.preventDefault();
          void post();
        }}
      >
        <label className="field" htmlFor={fieldId}>
          Add a comment
        </label>
        <textarea
          id={fieldId}
          rows={3}
          value={draft}
          maxLength={COMMENT_MAX_LENGTH}
          placeholder="Write a comment. Ctrl+Enter posts it."
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void post();
            }
          }}
        />
        <button type="submit" className="button button-primary" disabled={!body || posting}>
          {posting ? 'Posting…' : 'Post comment'}
        </button>
      </form>
    </section>
  );
}
