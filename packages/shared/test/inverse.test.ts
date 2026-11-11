import { describe, expect, it } from 'vitest';
import { invertOp } from '../src/inverse';
import { applyOp, opSchema, type BoardState, type Card, type Op } from '../src/model';

const card = (fields: Partial<Card> & Pick<Card, 'id' | 'columnId' | 'pos'>): Card => ({
  title: fields.id,
  description: '',
  labels: [],
  assigneeId: null,
  dueDate: null,
  ...fields,
});

function board(): BoardState {
  return {
    id: 'b1',
    title: 'Board',
    columns: {
      todo: { id: 'todo', title: 'To do', pos: 'G' },
      done: { id: 'done', title: 'Done', pos: 'V' },
    },
    cards: {
      c1: card({ id: 'c1', columnId: 'todo', pos: 'G', title: 'First' }),
      c2: card({
        id: 'c2',
        columnId: 'todo',
        pos: 'V',
        title: 'Second',
        description: 'Some notes',
        labels: ['red', 'teal'],
        assigneeId: 'u1',
        dueDate: '2026-11-14',
      }),
      c3: card({ id: 'c3', columnId: 'done', pos: 'G', title: 'Third', labels: ['blue'] }),
    },
  };
}

function apply(state: BoardState, op: Op): BoardState {
  const result = applyOp(state, op);
  if (!result.ok) throw new Error(`${op.type}: ${result.error}`);
  return result.state;
}

/** Applies `op`, then its inverse, and returns the inverse with the board it ends on. */
function roundTrip(before: BoardState, op: Op) {
  const inverse = invertOp(before, op);
  if (!inverse) throw new Error('No inverse');
  for (const step of inverse) expect(opSchema.safeParse(step).success, JSON.stringify(step)).toBe(true);
  const after = apply(before, op);
  return { inverse, restored: inverse.reduce(apply, after) };
}

const cases: [string, Op][] = [
  ['board.rename', { type: 'board.rename', title: 'Renamed' }],
  ['column.add', { type: 'column.add', id: 'new', title: 'New', pos: 'Z' }],
  ['column.rename', { type: 'column.rename', id: 'todo', title: 'Backlog' }],
  ['column.move', { type: 'column.move', id: 'todo', pos: 'Z' }],
  ['column.delete', { type: 'column.delete', id: 'todo' }],
  ['card.add', { type: 'card.add', id: 'c9', columnId: 'done', title: 'New card', pos: 'V' }],
  ['card.update (one field)', { type: 'card.update', id: 'c2', patch: { description: 'Rewritten' } }],
  [
    'card.update (every field)',
    {
      type: 'card.update',
      id: 'c2',
      patch: { title: 'Other', description: '', labels: ['green'], assigneeId: null, dueDate: '2027-01-01' },
    },
  ],
  ['card.update (due date)', { type: 'card.update', id: 'c1', patch: { dueDate: '2026-12-25' } }],
  ['card.move (other column)', { type: 'card.move', id: 'c2', columnId: 'done', pos: 'V' }],
  ['card.move (same column)', { type: 'card.move', id: 'c1', columnId: 'todo', pos: 'Z' }],
  ['card.delete (plain)', { type: 'card.delete', id: 'c1' }],
  ['card.delete (every field set)', { type: 'card.delete', id: 'c2' }],
];

describe('invertOp', () => {
  it.each(cases)('reverses %s', (_name, op) => {
    const before = board();
    const { restored } = roundTrip(before, op);
    expect(restored).toEqual(before);
  });

  it('covers every operation type', () => {
    const covered = new Set(cases.map(([, op]) => op.type));
    const all = opSchema.options.map((option) => option.shape.type.value);
    expect([...covered].sort()).toEqual([...all].sort());
  });

  it('re-adds a deleted column with all its cards and their fields', () => {
    const before = board();
    const { inverse, restored } = roundTrip(before, { type: 'column.delete', id: 'todo' });
    expect(inverse[0]).toEqual({ type: 'column.add', id: 'todo', title: 'To do', pos: 'G' });
    expect(inverse.filter((op) => op.type === 'card.add').map((op) => op.id)).toEqual(['c1', 'c2']);
    expect(restored.cards.c2).toEqual(before.cards.c2);
    expect(restored.cards.c3).toEqual(before.cards.c3);
  });

  it('restores a deleted card with an add and then one update', () => {
    const { inverse } = roundTrip(board(), { type: 'card.delete', id: 'c2' });
    expect(inverse).toEqual([
      { type: 'card.add', id: 'c2', columnId: 'todo', title: 'Second', pos: 'V' },
      {
        type: 'card.update',
        id: 'c2',
        patch: { description: 'Some notes', labels: ['red', 'teal'], assigneeId: 'u1', dueDate: '2026-11-14' },
      },
    ]);
  });

  it('leaves out the update when a deleted card had nothing beyond its title', () => {
    const { inverse } = roundTrip(board(), { type: 'card.delete', id: 'c1' });
    expect(inverse).toEqual([{ type: 'card.add', id: 'c1', columnId: 'todo', title: 'First', pos: 'G' }]);
  });

  it('restores only the fields a card.update changed', () => {
    const inverse = invertOp(board(), { type: 'card.update', id: 'c2', patch: { title: 'New', assigneeId: 'u1' } });
    expect(inverse).toEqual([{ type: 'card.update', id: 'c2', patch: { title: 'Second' } }]);
  });

  it('does not undo a later change to a field the update did not touch', () => {
    const before = board();
    const op: Op = { type: 'card.update', id: 'c2', patch: { title: 'New' } };
    const inverse = invertOp(before, op)!;
    // Someone else edits the description in between.
    const meanwhile = apply(apply(before, op), { type: 'card.update', id: 'c2', patch: { description: 'Theirs' } });
    const restored = inverse.reduce(apply, meanwhile);
    expect(restored.cards.c2!.title).toBe('Second');
    expect(restored.cards.c2!.description).toBe('Theirs');
  });

  it('returns no operations for a change that changes nothing', () => {
    const before = board();
    expect(invertOp(before, { type: 'board.rename', title: 'Board' })).toEqual([]);
    expect(invertOp(before, { type: 'column.rename', id: 'todo', title: 'To do' })).toEqual([]);
    expect(invertOp(before, { type: 'column.move', id: 'todo', pos: 'G' })).toEqual([]);
    expect(invertOp(before, { type: 'card.update', id: 'c1', patch: { title: 'First' } })).toEqual([]);
    expect(invertOp(before, { type: 'card.update', id: 'c2', patch: { labels: ['red', 'teal', 'red'] } })).toEqual([]);
    expect(invertOp(before, { type: 'card.move', id: 'c1', columnId: 'todo', pos: 'G' })).toEqual([]);
  });

  it('returns null when the operation would not apply', () => {
    const before = board();
    expect(invertOp(before, { type: 'card.delete', id: 'missing' })).toBeNull();
    expect(invertOp(before, { type: 'card.update', id: 'missing', patch: { title: 'x' } })).toBeNull();
    expect(invertOp(before, { type: 'card.move', id: 'c1', columnId: 'missing', pos: 'G' })).toBeNull();
    expect(invertOp(before, { type: 'column.add', id: 'todo', title: 'Again', pos: 'Z' })).toBeNull();
    expect(invertOp(before, { type: 'column.delete', id: 'missing' })).toBeNull();
    expect(invertOp(before, { type: 'card.add', id: 'c1', columnId: 'todo', title: 'Again', pos: 'Z' })).toBeNull();
  });

  it('restores card fields it does not know about by name', () => {
    // A field added to the model later travels in the patch like the others.
    const before = board();
    const withExtra = {
      ...before,
      cards: { ...before.cards, c1: { ...before.cards.c1!, dueDate: '2030-01-31' } },
    };
    const { restored } = roundTrip(withExtra, { type: 'card.delete', id: 'c1' });
    expect(restored).toEqual(withExtra);
  });

  it('does not restore a card by halves when it can no longer be added back', () => {
    const before = board();
    const legacy = {
      ...before,
      cards: { ...before.cards, c2: { ...before.cards.c2!, title: 'x'.repeat(200) } },
    };
    expect(invertOp(legacy, { type: 'card.delete', id: 'c2' })).toEqual([]);
    const columnUndo = invertOp(legacy, { type: 'column.delete', id: 'todo' })!;
    expect(columnUndo.map((op) => op.type)).toEqual(['column.add', 'card.add']);
    // Undoing an edit still restores the fields that are allowed.
    const edit: Op = { type: 'card.update', id: 'c2', patch: { title: 'Short', description: 'New' } };
    expect(invertOp(legacy, edit)).toEqual([{ type: 'card.update', id: 'c2', patch: { description: 'Some notes' } }]);
  });

  it('never mutates the board it is given', () => {
    const before = board();
    const frozen = JSON.stringify(before);
    for (const [, op] of cases) invertOp(before, op);
    expect(JSON.stringify(before)).toBe(frozen);
  });
});
