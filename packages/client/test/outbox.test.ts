import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOutbox } from '../src/board/outbox';

describe('outbox', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends at most the limit per window, in order', () => {
    const sent: number[] = [];
    const outbox = createOutbox<number>((n) => sent.push(n), { limit: 3, windowMs: 1000 });
    for (let i = 0; i < 8; i++) outbox.push(i);
    expect(sent).toEqual([0, 1, 2]);
    vi.advanceTimersByTime(999);
    expect(sent).toEqual([0, 1, 2]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([0, 1, 2, 3, 4, 5]);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('forgets what it has not sent when cleared', () => {
    const sent: number[] = [];
    const outbox = createOutbox<number>((n) => sent.push(n), { limit: 1, windowMs: 1000 });
    outbox.push(1);
    outbox.push(2);
    outbox.clear();
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([1]);
    outbox.push(3);
    expect(sent).toEqual([1, 3]);
  });
});
