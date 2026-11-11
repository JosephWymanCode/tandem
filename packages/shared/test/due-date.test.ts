import { describe, expect, it } from 'vitest';
import { applyOp, describeOp, opSchema, type BoardState, type Op } from '../src/model';

function board(): BoardState {
  return {
    id: 'b1',
    title: 'Board',
    columns: { todo: { id: 'todo', title: 'To do', pos: 'G' } },
    cards: {
      c1: { id: 'c1', columnId: 'todo', title: 'First', description: '', labels: [], assigneeId: null, dueDate: null, pos: 'G' },
    },
  };
}

function apply(state: BoardState, op: Op): BoardState {
  const result = applyOp(state, op);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

const update = (dueDate: unknown) => opSchema.safeParse({ type: 'card.update', id: 'c1', patch: { dueDate } });

describe('due date schema', () => {
  it('accepts real calendar dates and null', () => {
    for (const date of ['2026-11-14', '2028-02-29', '2026-12-31', '2027-01-01', '1000-01-01', '9999-12-31', '2000-02-29', null]) {
      expect(update(date).success, String(date)).toBe(true);
    }
  });

  it('rejects dates that do not exist and anything not in YYYY-MM-DD form', () => {
    for (const date of [
      '2026-02-30',
      '1900-02-29',
      '0202-11-14',
      '0050-01-01',
      '2026-11-00',
      '2026-11-31',
      '2027-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-04-31',
      'next Friday',
      '14/11/2026',
      '2026-11-14T00:00:00Z',
      '2026-1-4',
      '',
      20261114,
    ]) {
      expect(update(date).success, String(date)).toBe(false);
    }
  });
});

describe('due dates in the reducer', () => {
  it('creates cards without a due date', () => {
    const state = apply(board(), { type: 'card.add', id: 'c2', columnId: 'todo', title: 'New', pos: 'V' });
    expect(state.cards.c2!.dueDate).toBeNull();
  });

  it('sets, changes and clears a due date, leaving other fields alone', () => {
    let state = apply(board(), { type: 'card.update', id: 'c1', patch: { dueDate: '2026-11-14' } });
    expect(state.cards.c1).toMatchObject({ dueDate: '2026-11-14', title: 'First' });
    state = apply(state, { type: 'card.update', id: 'c1', patch: { dueDate: '2026-12-01' } });
    expect(state.cards.c1!.dueDate).toBe('2026-12-01');
    state = apply(state, { type: 'card.update', id: 'c1', patch: { title: 'Renamed' } });
    expect(state.cards.c1!.dueDate).toBe('2026-12-01');
    state = apply(state, { type: 'card.update', id: 'c1', patch: { dueDate: null } });
    expect(state.cards.c1!.dueDate).toBeNull();
  });

  it('describes the change in the activity feed', () => {
    expect(describeOp(board(), { type: 'card.update', id: 'c1', patch: { dueDate: '2026-11-14' } })).toBe(
      'changed the due date of “First”',
    );
  });
});
