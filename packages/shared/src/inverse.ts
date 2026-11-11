import { applyOp, cardsInColumn, opSchema, type BoardState, type Card, type Op } from './model';

/** Card fields that `card.add` and `card.move` set directly; every other field is restored with a patch. */
const PLACEMENT_FIELDS = new Set(['id', 'columnId', 'title', 'pos']);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Keeps only the operations the server would accept, so an inverse never fails validation. */
const valid = (ops: Op[]): Op[] => ops.filter((op) => opSchema.safeParse(op).success);

/** A card exactly as `card.add` creates it, used to find out which fields still need restoring. */
function freshCard(card: Card): Card | null {
  const empty: BoardState = {
    id: '',
    title: '',
    columns: { [card.columnId]: { id: card.columnId, title: '', pos: card.pos } },
    cards: {},
  };
  const result = applyOp(empty, {
    type: 'card.add',
    id: card.id,
    columnId: card.columnId,
    title: card.title,
    pos: card.pos,
  });
  return result.ok ? (result.state.cards[card.id] ?? null) : null;
}

/** The operations that put a deleted card back: add it, then restore whatever `card.add` does not set. */
function restoreCard(card: Card): Op[] {
  const add: Op = { type: 'card.add', id: card.id, columnId: card.columnId, title: card.title, pos: card.pos };
  // A card that cannot be added back (an old title the rules no longer allow, say) is not restored by halves.
  if (!opSchema.safeParse(add).success) return [];
  const ops: Op[] = [add];
  const fresh = freshCard(card) as Record<string, unknown> | null;
  const patch: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(card)) {
    if (PLACEMENT_FIELDS.has(field) || value === undefined) continue;
    if (fresh && same(fresh[field], value)) continue;
    // A field that cannot be patched is left out rather than spoiling the whole restore.
    const alone = { type: 'card.update', id: card.id, patch: { [field]: value } };
    if (opSchema.safeParse(alone).success) patch[field] = value;
  }
  if (Object.keys(patch).length > 0) {
    ops.push({ type: 'card.update', id: card.id, patch } as Op);
  }
  return ops;
}

/**
 * Returns the operations that reverse `op`, given the board as it was just
 * before `op` was applied. Returns null if `op` would not apply to that board,
 * and an empty list if `op` applies but changes nothing.
 *
 * Every returned operation passes `opSchema`.
 */
export function invertOp(before: BoardState, op: Op): Op[] | null {
  if (!applyOp(before, op).ok) return null;

  switch (op.type) {
    case 'board.rename':
      if (before.title === op.title) return [];
      return valid([{ type: 'board.rename', title: before.title }]);

    case 'column.add':
      return [{ type: 'column.delete', id: op.id }];

    case 'column.rename': {
      const column = before.columns[op.id]!;
      if (column.title === op.title) return [];
      return valid([{ type: 'column.rename', id: op.id, title: column.title }]);
    }

    case 'column.move': {
      const column = before.columns[op.id]!;
      if (column.pos === op.pos) return [];
      return valid([{ type: 'column.move', id: op.id, pos: column.pos }]);
    }

    case 'column.delete': {
      const column = before.columns[op.id]!;
      const add: Op = { type: 'column.add', id: column.id, title: column.title, pos: column.pos };
      if (!opSchema.safeParse(add).success) return [];
      const ops: Op[] = [add];
      for (const card of cardsInColumn(before, op.id)) ops.push(...restoreCard(card));
      return ops;
    }

    case 'card.add':
      return [{ type: 'card.delete', id: op.id }];

    case 'card.update': {
      const card = before.cards[op.id]! as unknown as Record<string, unknown>;
      const after = applyOp(before, op);
      const next = (after.ok ? after.state.cards[op.id] : undefined) as unknown as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const field of Object.keys(op.patch)) {
        // Fields the operation left as they were are not touched, so undoing
        // it cannot overwrite a later change to them.
        if (card[field] === undefined || same(card[field], next[field])) continue;
        // A value the rules no longer allow is left out; the other fields are still restored.
        if (opSchema.safeParse({ type: 'card.update', id: op.id, patch: { [field]: card[field] } }).success) {
          patch[field] = card[field];
        }
      }
      if (Object.keys(patch).length === 0) return [];
      return valid([{ type: 'card.update', id: op.id, patch } as Op]);
    }

    case 'card.move': {
      const card = before.cards[op.id]!;
      if (card.columnId === op.columnId && card.pos === op.pos) return [];
      return valid([{ type: 'card.move', id: op.id, columnId: card.columnId, pos: card.pos }]);
    }

    case 'card.delete':
      return restoreCard(before.cards[op.id]!);
  }
}
