import { beforeEach, describe, expect, it } from 'vitest';
import type { Comment } from '@tandem/shared';
import { useComments } from '../src/board/comments';
import { relativeTime } from '../src/board/relativeTime';

const comment = (id: string, createdAt: number, cardId = 'card'): Comment => ({
  id,
  cardId,
  authorId: 'ada',
  authorName: 'Ada',
  body: id,
  createdAt,
});

const store = () => useComments.getState();
const ids = () => store().threads.card?.map((c) => c.id);

beforeEach(() => store().reset());

describe('comments store', () => {
  it('counts from the server until a thread is loaded, then from the thread', () => {
    store().handshake({ card: 2 });
    store().added(comment('c', 3), true);
    expect(store().counts.card).toBe(3);
    store().loaded('card', [comment('a', 1)]);
    expect(store().counts.card).toBe(1);
    store().removed('card', 'a', true);
    expect(store().counts.card).toBeUndefined();
  });

  it('takes each change once, whether it comes from the request or the broadcast', () => {
    store().loaded('card', []);
    store().added(comment('a', 1), false);
    store().added(comment('a', 1), true);
    expect(ids()).toEqual(['a']);
    expect(store().counts.card).toBe(1);
    store().removed('card', 'a', false);
    store().removed('card', 'a', true);
    expect(ids()).toEqual([]);
  });

  it('keeps changes announced while the thread was being fetched', () => {
    // First open: nothing loaded yet.
    store().loading('card');
    store().added(comment('late', 5), true);
    store().loaded('card', [comment('early', 1)]);
    expect(ids()).toEqual(['early', 'late']);
    expect(store().counts.card).toBe(2);

    // Refetch after a reconnection: the snapshot predates an add and a delete.
    store().loading('card');
    store().added(comment('newer', 9), true);
    store().removed('card', 'early', true);
    store().loaded('card', [comment('early', 1), comment('late', 5)]);
    expect(ids()).toEqual(['late', 'newer']);
    expect(store().counts.card).toBe(2);
  });

  it('forgets changes from a fetch that was abandoned', () => {
    store().loading('card');
    store().added(comment('a', 1), true);
    store().stopLoading('card');
    store().loaded('card', []);
    expect(ids()).toEqual([]);
  });
});

describe('relativeTime', () => {
  const now = new Date(2026, 5, 15, 12, 0).getTime();
  it('reads naturally', () => {
    expect(relativeTime(now - 20_000, now)).toBe('just now');
    expect(relativeTime(now + 5_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(relativeTime(now - 3 * 86_400_000, now)).toMatch(/12/);
  });
});
