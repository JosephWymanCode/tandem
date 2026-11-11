import { beforeEach, describe, expect, it } from 'vitest';
import { byPos, initialKeys, type Card } from '@tandem/shared';
import { NO_FILTER, dropPosition, isFiltering, matches, useFilter, type CardFilter } from '../src/board/filter';

const card = (patch: Partial<Card> = {}): Card => ({
  id: 'c1',
  columnId: 'col',
  title: 'Write the launch announcement',
  description: 'Keep it under 200 words.',
  labels: ['amber'],
  assigneeId: 'ada',
  pos: 'V',
  ...patch,
});

const filter = (patch: Partial<CardFilter>): CardFilter => ({ ...NO_FILTER, ...patch });

describe('matches', () => {
  it('lets everything through when nothing is chosen', () => {
    expect(matches(card(), NO_FILTER)).toBe(true);
    expect(matches(card({ labels: [], assigneeId: null, description: '' }), NO_FILTER)).toBe(true);
  });

  it('searches the title and the description without regard to case', () => {
    expect(matches(card(), filter({ query: 'LAUNCH' }))).toBe(true);
    expect(matches(card(), filter({ query: '200 words' }))).toBe(true);
    expect(matches(card(), filter({ query: 'pricing' }))).toBe(false);
  });

  it('ignores spaces around the search text', () => {
    expect(matches(card(), filter({ query: '  launch ' }))).toBe(true);
    expect(matches(card(), filter({ query: '   ' }))).toBe(true);
  });

  it('needs at least one of the chosen labels', () => {
    expect(matches(card(), filter({ labels: ['amber'] }))).toBe(true);
    expect(matches(card(), filter({ labels: ['red', 'amber'] }))).toBe(true);
    expect(matches(card(), filter({ labels: ['red', 'blue'] }))).toBe(false);
    expect(matches(card({ labels: [] }), filter({ labels: ['red'] }))).toBe(false);
  });

  it('filters by who a card is assigned to', () => {
    expect(matches(card(), filter({ assignee: 'ada' }))).toBe(true);
    expect(matches(card(), filter({ assignee: 'grace' }))).toBe(false);
    expect(matches(card(), filter({ assignee: 'none' }))).toBe(false);
    expect(matches(card({ assigneeId: null }), filter({ assignee: 'none' }))).toBe(true);
    expect(matches(card({ assigneeId: null }), filter({ assignee: 'ada' }))).toBe(false);
  });

  it('requires every part of the filter to hold', () => {
    const all = filter({ query: 'launch', labels: ['amber'], assignee: 'ada' });
    expect(matches(card(), all)).toBe(true);
    expect(matches(card({ title: 'Something else', description: '' }), all)).toBe(false);
    expect(matches(card({ labels: ['green'] }), all)).toBe(false);
    expect(matches(card({ assigneeId: 'grace' }), all)).toBe(false);
  });
});

describe('isFiltering', () => {
  it('is true only when something is chosen', () => {
    expect(isFiltering(NO_FILTER)).toBe(false);
    expect(isFiltering(filter({ query: '  ' }))).toBe(false);
    expect(isFiltering(filter({ query: 'a' }))).toBe(true);
    expect(isFiltering(filter({ labels: ['red'] }))).toBe(true);
    expect(isFiltering(filter({ assignee: 'none' }))).toBe(true);
  });
});

describe('dropPosition', () => {
  const ids = ['a', 'h1', 'h2', 'b', 'c'];
  const column = initialKeys(ids.length).map((pos, index) => ({ id: ids[index]!, pos }));

  /** The order of the column once `id` has the position the helper returns. */
  const orderAfter = (full: { id: string; pos: string }[], id: string, aboveId: string | null) => {
    const pos = dropPosition(full, id, aboveId);
    return [...full.filter((item) => item.id !== id), { id, pos }].sort(byPos).map((item) => item.id);
  };

  it('puts the card directly under the visible card above it, ahead of hidden cards', () => {
    // h1 and h2 are hidden; c is dropped between a and b.
    expect(orderAfter(column, 'c', 'a')).toEqual(['a', 'c', 'h1', 'h2', 'b']);
  });

  it('puts the card at the start of the full column when dropped first', () => {
    expect(orderAfter(column, 'c', null)).toEqual(['c', 'a', 'h1', 'h2', 'b']);
    // a is hidden and b is dropped above everything that is visible.
    expect(orderAfter(column, 'b', null)).toEqual(['b', 'a', 'h1', 'h2', 'c']);
  });

  it('puts the card at the end when dropped under the last card', () => {
    expect(orderAfter(column, 'a', 'c')).toEqual(['h1', 'h2', 'b', 'c', 'a']);
  });

  it('skips over the moved card itself when it is the next one down', () => {
    expect(orderAfter(column, 'h1', 'a')).toEqual(['a', 'h1', 'h2', 'b', 'c']);
    expect(orderAfter(column, 'b', 'h1')).toEqual(['a', 'h1', 'b', 'h2', 'c']);
  });

  it('works for a card arriving from another column', () => {
    expect(orderAfter(column, 'new', 'h2')).toEqual(['a', 'h1', 'h2', 'new', 'b', 'c']);
    expect(orderAfter([], 'new', null)).toEqual(['new']);
  });

  it('falls back to the end when the card above is no longer in the column', () => {
    expect(orderAfter(column, 'a', 'gone')).toEqual(['h1', 'h2', 'b', 'c', 'a']);
  });
});

describe('the filter store', () => {
  beforeEach(() => useFilter.getState().clear());

  it('toggles labels on and off and clears everything', () => {
    const store = useFilter.getState();
    store.setQuery('beta');
    store.toggleLabel('red');
    store.toggleLabel('blue');
    store.toggleLabel('red');
    store.setAssignee('none');
    expect(useFilter.getState()).toMatchObject({ query: 'beta', labels: ['blue'], assignee: 'none' });

    store.clear();
    expect(useFilter.getState()).toMatchObject(NO_FILTER);
    expect(isFiltering(useFilter.getState())).toBe(false);
  });
});
