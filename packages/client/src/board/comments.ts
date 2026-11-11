import { create } from 'zustand';
import type { Comment } from '@tandem/shared';

type Change = { kind: 'added'; comment: Comment } | { kind: 'removed'; cardId: string; commentId: string };

interface CommentsStore {
  /** Comments per card. A card that is missing has none. */
  counts: Record<string, number>;
  /** Threads that have been fetched, oldest comment first. */
  threads: Record<string, Comment[]>;
  /** Goes up on every (re)connection, so open threads know to fetch again for anything they missed. */
  epoch: number;

  /** Called with the counts the server sends when a connection is made. */
  handshake: (counts: Record<string, number>) => void;
  /** Call just before fetching a thread, then `loaded` when it succeeds or `stopLoading` when it fails or is abandoned. */
  loading: (cardId: string) => void;
  loaded: (cardId: string, comments: Comment[]) => void;
  stopLoading: (cardId: string) => void;
  /** `announced` is true when the server broadcast the change, false when it is this person's own request returning. */
  added: (comment: Comment, announced: boolean) => void;
  removed: (cardId: string, commentId: string, announced: boolean) => void;
  reset: () => void;
}

const initial = { counts: {}, threads: {}, epoch: 0 };

/**
 * Changes announced while a thread is being fetched. The fetched list may or
 * may not include them, so they are applied again on top of it; every change
 * is safe to apply twice.
 */
const inFlight = new Map<string, Change[]>();

const withCount = (counts: Record<string, number>, cardId: string, count: number) => {
  const next = { ...counts };
  if (count > 0) next[cardId] = count;
  else delete next[cardId];
  return next;
};

/**
 * Comments live beside the board rather than in it: they are not operations.
 * Both a person's own request and the server's broadcast report each change,
 * so every update here is safe to receive twice. Where a thread has been
 * fetched its count is its length; otherwise the count follows the server.
 */
export const useComments = create<CommentsStore>((set, get) => {
  const apply = (change: Change, announced: boolean) => {
    const { threads, counts } = get();
    const cardId = change.kind === 'added' ? change.comment.cardId : change.cardId;
    const thread = threads[cardId];
    if (thread) {
      const next =
        change.kind === 'added'
          ? thread.some((existing) => existing.id === change.comment.id)
            ? thread
            : [...thread, change.comment].sort((a, b) => a.createdAt - b.createdAt)
          : thread.filter((existing) => existing.id !== change.commentId);
      if (next.length === thread.length) return;
      set({ threads: { ...threads, [cardId]: next }, counts: withCount(counts, cardId, next.length) });
    } else if (announced) {
      const step = change.kind === 'added' ? 1 : -1;
      set({ counts: withCount(counts, cardId, (counts[cardId] ?? 0) + step) });
    }
  };

  const record = (change: Change, announced: boolean) => {
    const cardId = change.kind === 'added' ? change.comment.cardId : change.cardId;
    inFlight.get(cardId)?.push(change);
    apply(change, announced);
  };

  return {
    ...initial,

    handshake: (counts) => set({ counts, epoch: get().epoch + 1 }),

    loading: (cardId) => inFlight.set(cardId, []),

    loaded: (cardId, comments) => {
      const { threads, counts } = get();
      set({ threads: { ...threads, [cardId]: comments }, counts: withCount(counts, cardId, comments.length) });
      const missed = inFlight.get(cardId) ?? [];
      inFlight.delete(cardId);
      for (const change of missed) apply(change, false);
    },

    stopLoading: (cardId) => inFlight.delete(cardId),

    added: (comment, announced) => record({ kind: 'added', comment }, announced),

    removed: (cardId, commentId, announced) => record({ kind: 'removed', cardId, commentId }, announced),

    reset: () => {
      inFlight.clear();
      set({ ...initial });
    },
  };
});

export const useCommentCount = (cardId: string) => useComments((state) => state.counts[cardId] ?? 0);
