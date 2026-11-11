import { describe, expect, it } from 'vitest';
import { applyOp, invertOp, type BoardState, type Card, type Op } from '@tandem/shared';
import {
  HISTORY_LIMIT,
  dropRejected,
  emptyHistory,
  planStep,
  recordChange,
  recordStep,
  takeStep,
  type HistoryEntry,
} from '../src/board/history';

const card = (id: string, columnId: string, pos: string): Card => ({
  id,
  columnId,
  title: id,
  description: '',
  labels: [],
  assigneeId: null,
  dueDate: null,
  pos,
});

function board(): BoardState {
  return {
    id: 'b1',
    title: 'Board',
    columns: {
      todo: { id: 'todo', title: 'To do', pos: 'G' },
      done: { id: 'done', title: 'Done', pos: 'V' },
    },
    cards: { c1: card('c1', 'todo', 'G'), c2: card('c2', 'todo', 'V') },
  };
}

const apply = (state: BoardState, op: Op): BoardState => {
  const result = applyOp(state, op);
  if (!result.ok) throw new Error(result.error);
  return result.state;
};

const entry = (ops: Op[], cid = 'x'): HistoryEntry => ({ ops, cids: [cid] });
const rename = (title: string): Op => ({ type: 'board.rename', title });

describe('history stacks', () => {
  it('records changes and clears what could be redone', () => {
    let history = recordStep(emptyHistory, 'redo', entry([rename('A')]));
    expect(history.redo).toHaveLength(1);
    history = recordChange(history, entry([rename('B')]));
    expect(history.undo).toHaveLength(1);
    expect(history.redo).toHaveLength(0);
  });

  it(`keeps at most ${HISTORY_LIMIT} entries, dropping the oldest`, () => {
    let history = emptyHistory;
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) history = recordChange(history, entry([rename(`T${i}`)], `c${i}`));
    expect(history.undo).toHaveLength(HISTORY_LIMIT);
    expect(history.undo[0]!.cids).toEqual(['c5']);
  });

  it('ignores a change that changed nothing, keeping what could be redone', () => {
    const history = recordStep(emptyHistory, 'redo', entry([rename('A')]));
    expect(recordChange(history, entry([]))).toBe(history);
  });

  it('drops the entries that depend on a rejected operation', () => {
    let history = recordChange(emptyHistory, entry([rename('A')], 'keep'));
    history = recordChange(history, entry([rename('B')], 'bad'));
    history = recordStep(history, 'redo', { ops: [rename('C')], cids: ['other', 'bad'] });
    history = dropRejected(history, 'bad');
    expect(history.undo.map((e) => e.cids)).toEqual([['keep']]);
    expect(history.redo).toHaveLength(0);
    expect(dropRejected(history, 'unknown')).toBe(history);
  });
});

describe('planStep and takeStep', () => {
  it('undoes and redoes a move', () => {
    const before = board();
    const move: Op = { type: 'card.move', id: 'c1', columnId: 'done', pos: 'G' };
    const after = apply(before, move);
    const undo = planStep(after, invertOp(before, move)!);
    const undone = undo.apply.reduce(apply, after);
    expect(undone).toEqual(before);
    const redo = planStep(undone, undo.inverse);
    expect(redo.apply.reduce(apply, undone)).toEqual(after);
  });

  it('skips operations that no longer apply and keeps the rest', () => {
    const before = board();
    const del: Op = { type: 'column.delete', id: 'todo' };
    const after = apply(before, del);
    const inverse = invertOp(before, del)!;
    // Someone else adds a card with the id c2 meanwhile in another column.
    const meanwhile = apply(after, { type: 'card.add', id: 'c2', columnId: 'done', title: 'Theirs', pos: 'V' });
    const step = planStep(meanwhile, inverse);
    expect(step.apply.map((op) => op.type)).toEqual(['column.add', 'card.add']);
    const restored = step.apply.reduce(apply, meanwhile);
    expect(restored.cards.c1).toEqual(before.cards.c1);
    expect(restored.cards.c2!.title).toBe('Theirs');
    // Its reverse undoes exactly what was applied, last first.
    expect(step.inverse).toEqual([
      { type: 'card.delete', id: 'c1' },
      { type: 'column.delete', id: 'todo' },
    ]);
  });

  it('does not remove a column that someone else has since put cards in', () => {
    const before = board();
    const add: Op = { type: 'column.add', id: 'qa', title: 'QA', pos: 'Z' };
    const inverse = invertOp(before, add)!;
    const theirs = apply(apply(before, add), { type: 'card.add', id: 'c9', columnId: 'qa', title: 'Theirs', pos: 'G' });
    expect(planStep(theirs, inverse).apply).toEqual([]);
    // Once the column is empty again it can be removed.
    const emptied = apply(theirs, { type: 'card.delete', id: 'c9' });
    expect(planStep(emptied, inverse).apply).toEqual(inverse);
  });

  it('passes over entries that no longer apply at all', () => {
    const view = board();
    const stack = [
      entry([{ type: 'board.rename', title: 'Old' }], 'a'),
      entry([{ type: 'card.delete', id: 'gone' }], 'b'),
      entry([{ type: 'card.update', id: 'c1', patch: { title: 'c1' } }], 'c'),
    ];
    const { stack: rest, step } = takeStep(view, stack);
    expect(rest).toHaveLength(0);
    expect(step!.apply).toEqual([{ type: 'board.rename', title: 'Old' }]);
    expect(takeStep(view, [entry([{ type: 'card.delete', id: 'gone' }])])).toEqual({ stack: [], step: null });
  });
});
