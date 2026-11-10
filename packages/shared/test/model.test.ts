import { describe, expect, it } from 'vitest';
import {
  applyOp,
  cardsInColumn,
  describeOp,
  opSchema,
  sortedColumns,
  type BoardState,
  type Op,
} from '../src/model';

function board(): BoardState {
  return {
    id: 'b1',
    title: 'Board',
    columns: {
      todo: { id: 'todo', title: 'To do', pos: 'G' },
      done: { id: 'done', title: 'Done', pos: 'V' },
    },
    cards: {
      c1: { id: 'c1', columnId: 'todo', title: 'First', description: '', labels: [], assigneeId: null, pos: 'G' },
      c2: { id: 'c2', columnId: 'todo', title: 'Second', description: '', labels: [], assigneeId: null, pos: 'V' },
    },
  };
}

function apply(state: BoardState, op: Op): BoardState {
  const result = applyOp(state, op);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe('applyOp', () => {
  it('never mutates the board it is given', () => {
    const before = board();
    const frozen = JSON.stringify(before);
    apply(before, { type: 'card.move', id: 'c1', columnId: 'done', pos: 'V' });
    apply(before, { type: 'column.delete', id: 'todo' });
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it('adds, moves and deletes cards', () => {
    let state = board();
    state = apply(state, { type: 'card.add', id: 'c3', columnId: 'done', title: 'Third', pos: 'V' });
    expect(cardsInColumn(state, 'done').map((c) => c.id)).toEqual(['c3']);

    state = apply(state, { type: 'card.move', id: 'c2', columnId: 'done', pos: 'G' });
    expect(cardsInColumn(state, 'done').map((c) => c.id)).toEqual(['c2', 'c3']);
    expect(cardsInColumn(state, 'todo').map((c) => c.id)).toEqual(['c1']);

    state = apply(state, { type: 'card.delete', id: 'c2' });
    expect(state.cards.c2).toBeUndefined();
  });

  it('merges edits to different fields of the same card', () => {
    let state = board();
    state = apply(state, { type: 'card.update', id: 'c1', patch: { title: 'Renamed' } });
    state = apply(state, { type: 'card.update', id: 'c1', patch: { description: 'Details' } });
    expect(state.cards.c1).toMatchObject({ title: 'Renamed', description: 'Details' });
  });

  it('deleting a column deletes its cards', () => {
    const state = apply(board(), { type: 'column.delete', id: 'todo' });
    expect(Object.keys(state.cards)).toEqual([]);
    expect(sortedColumns(state).map((c) => c.id)).toEqual(['done']);
  });

  it('reorders columns by position', () => {
    const state = apply(board(), { type: 'column.move', id: 'done', pos: 'A' });
    expect(sortedColumns(state).map((c) => c.id)).toEqual(['done', 'todo']);
  });

  it('rejects operations on things that no longer exist', () => {
    expect(applyOp(board(), { type: 'card.delete', id: 'nope' }).ok).toBe(false);
    expect(applyOp(board(), { type: 'card.move', id: 'c1', columnId: 'nope', pos: 'V' }).ok).toBe(false);
    expect(applyOp(board(), { type: 'card.add', id: 'c1', columnId: 'todo', title: 'Dup', pos: 'V' }).ok).toBe(
      false,
    );
  });
});

describe('opSchema', () => {
  it('accepts a valid operation and trims titles', () => {
    const op = opSchema.parse({ type: 'card.add', id: 'c9', columnId: 'todo', title: '  Hello  ', pos: 'V' });
    expect(op).toMatchObject({ title: 'Hello' });
  });

  it('rejects malformed operations', () => {
    expect(opSchema.safeParse({ type: 'card.add', id: 'c9', columnId: 'todo', title: '', pos: 'V' }).success).toBe(
      false,
    );
    expect(opSchema.safeParse({ type: 'card.move', id: 'c1', columnId: 'todo', pos: 'V0' }).success).toBe(false);
    expect(opSchema.safeParse({ type: 'card.update', id: 'c1', patch: {} }).success).toBe(false);
    expect(opSchema.safeParse({ type: 'card.update', id: 'c1', patch: { owner: 'x' } }).success).toBe(false);
    expect(opSchema.safeParse({ type: 'drop.tables' }).success).toBe(false);
  });
});

describe('describeOp', () => {
  it('writes readable activity lines', () => {
    const state = board();
    expect(describeOp(state, { type: 'card.move', id: 'c1', columnId: 'done', pos: 'V' })).toBe(
      'moved “First” to “Done”',
    );
    expect(describeOp(state, { type: 'card.move', id: 'c1', columnId: 'todo', pos: 'z' })).toBe(
      'reordered “First” in “To do”',
    );
    expect(describeOp(state, { type: 'card.delete', id: 'c2' })).toBe('deleted “Second”');
  });
});
