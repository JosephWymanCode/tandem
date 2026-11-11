import { applyOp, invertOp, type BoardState, type Op } from '@tandem/shared';

/** How many of the person's own changes can be undone. */
export const HISTORY_LIMIT = 50;

/**
 * One step of history. `ops` are the operations to send when the step is
 * taken (the inverse of the change it reverses). `cids` identify the
 * operations whose rejection by the server makes this step meaningless.
 */
export interface HistoryEntry {
  ops: Op[];
  cids: string[];
}

export interface History {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

export const emptyHistory: History = { undo: [], redo: [] };

function push(stack: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  if (entry.ops.length === 0) return stack;
  return [...stack, entry].slice(-HISTORY_LIMIT);
}

/**
 * Records a new change by the person. Anything they had undone can no longer
 * be redone. A change that changed nothing leaves the history as it was.
 */
export function recordChange(history: History, entry: HistoryEntry): History {
  if (entry.ops.length === 0) return history;
  return { undo: push(history.undo, entry), redo: [] };
}

/** Records the step that reverses an undo (on the redo stack) or a redo (on the undo stack). */
export function recordStep(history: History, onto: keyof History, entry: HistoryEntry): History {
  return { ...history, [onto]: push(history[onto], entry) };
}

/** The server refused an operation: forget every step that depended on it. */
export function dropRejected(history: History, cid: string): History {
  const keep = (entry: HistoryEntry) => !entry.cids.includes(cid);
  if (history.undo.every(keep) && history.redo.every(keep)) return history;
  return { undo: history.undo.filter(keep), redo: history.redo.filter(keep) };
}

export interface Step {
  /** The operations that still apply to the board, in the order to send them. */
  apply: Op[];
  /** The operations that reverse `apply`, computed from the board as it is now. */
  inverse: Op[];
}

/**
 * Works out which of an entry's operations still apply to the board and how
 * to reverse them. An operation that no longer applies (someone else deleted
 * its card, say) or that would change nothing is left out. So is removing a
 * column that still holds cards: they were put there after the column was
 * added, by someone else, and undo never throws away other people's work.
 */
export function planStep(view: BoardState, ops: Op[]): Step {
  const apply: Op[] = [];
  let inverse: Op[] = [];
  let state = view;
  for (const op of ops) {
    if (op.type === 'column.delete' && Object.values(state.cards).some((card) => card.columnId === op.id)) continue;
    const reverse = invertOp(state, op);
    if (!reverse || reverse.length === 0) continue;
    const result = applyOp(state, op);
    if (!result.ok) continue;
    state = result.state;
    apply.push(op);
    // Reversing a sequence means reversing each operation, last one first.
    inverse = [...reverse, ...inverse];
  }
  return { apply, inverse };
}

/**
 * Takes the newest entry that still has an effect on the board off a stack.
 * Entries that no longer apply at all are discarded on the way.
 */
export function takeStep(view: BoardState, stack: HistoryEntry[]): { stack: HistoryEntry[]; step: Step | null } {
  const rest = [...stack];
  while (rest.length > 0) {
    const entry = rest.pop()!;
    const step = planStep(view, entry.ops);
    if (step.apply.length > 0) return { stack: rest, step };
  }
  return { stack: rest, step: null };
}
