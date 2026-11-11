import { z } from 'zod';
import { byPos } from './fractional';

export const LABELS = ['red', 'amber', 'green', 'teal', 'blue', 'violet'] as const;
export type Label = (typeof LABELS)[number];

export const LIMITS = {
  columnsPerBoard: 30,
  cardsPerBoard: 500,
  titleLength: 120,
  descriptionLength: 4000,
} as const;

export interface Column {
  id: string;
  title: string;
  pos: string;
}

export interface Card {
  id: string;
  columnId: string;
  title: string;
  description: string;
  labels: Label[];
  assigneeId: string | null;
  /** A calendar date in YYYY-MM-DD form, with no time zone. */
  dueDate: string | null;
  pos: string;
}

export interface BoardState {
  id: string;
  title: string;
  columns: Record<string, Column>;
  cards: Record<string, Card>;
}

// ---- Operations -----------------------------------------------------------

const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const pos = z
  .string()
  .max(64)
  .regex(/^[0-9A-Za-z]*[1-9A-Za-z]$/);
const title = z.string().trim().min(1).max(LIMITS.titleLength);

/** A real calendar date written as YYYY-MM-DD, such as 2026-11-14 (2026-02-30 is rejected). */
export const dueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, 'Not a real calendar date');

const cardPatch = z
  .object({
    title: title.optional(),
    description: z.string().max(LIMITS.descriptionLength).optional(),
    labels: z.array(z.enum(LABELS)).max(LABELS.length).optional(),
    assigneeId: id.nullable().optional(),
    dueDate: dueDateSchema.nullable().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'Patch is empty');

export const opSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('board.rename'), title }),
  z.object({ type: z.literal('column.add'), id, title, pos }),
  z.object({ type: z.literal('column.rename'), id, title }),
  z.object({ type: z.literal('column.move'), id, pos }),
  z.object({ type: z.literal('column.delete'), id }),
  z.object({ type: z.literal('card.add'), id, columnId: id, title, pos }),
  z.object({ type: z.literal('card.update'), id, patch: cardPatch }),
  z.object({ type: z.literal('card.move'), id, columnId: id, pos }),
  z.object({ type: z.literal('card.delete'), id }),
]);

export type Op = z.infer<typeof opSchema>;
export type CardPatch = z.infer<typeof cardPatch>;

// ---- Reducer --------------------------------------------------------------

export type ApplyResult = { ok: true; state: BoardState } | { ok: false; error: string };

const fail = (error: string): ApplyResult => ({ ok: false, error });

/**
 * Applies one operation to a board and returns the new board. Never mutates
 * its input. The server and every client run this same function, which is
 * what keeps them in agreement.
 */
export function applyOp(state: BoardState, op: Op): ApplyResult {
  switch (op.type) {
    case 'board.rename':
      return { ok: true, state: { ...state, title: op.title } };

    case 'column.add': {
      if (state.columns[op.id]) return fail('Column already exists');
      if (Object.keys(state.columns).length >= LIMITS.columnsPerBoard) {
        return fail(`A board can have at most ${LIMITS.columnsPerBoard} columns`);
      }
      const column: Column = { id: op.id, title: op.title, pos: op.pos };
      return { ok: true, state: { ...state, columns: { ...state.columns, [op.id]: column } } };
    }

    case 'column.rename': {
      const column = state.columns[op.id];
      if (!column) return fail('Column no longer exists');
      return {
        ok: true,
        state: { ...state, columns: { ...state.columns, [op.id]: { ...column, title: op.title } } },
      };
    }

    case 'column.move': {
      const column = state.columns[op.id];
      if (!column) return fail('Column no longer exists');
      return {
        ok: true,
        state: { ...state, columns: { ...state.columns, [op.id]: { ...column, pos: op.pos } } },
      };
    }

    case 'column.delete': {
      if (!state.columns[op.id]) return fail('Column no longer exists');
      const columns = { ...state.columns };
      delete columns[op.id];
      const cards: Record<string, Card> = {};
      for (const card of Object.values(state.cards)) {
        if (card.columnId !== op.id) cards[card.id] = card;
      }
      return { ok: true, state: { ...state, columns, cards } };
    }

    case 'card.add': {
      if (state.cards[op.id]) return fail('Card already exists');
      if (!state.columns[op.columnId]) return fail('Column no longer exists');
      if (Object.keys(state.cards).length >= LIMITS.cardsPerBoard) {
        return fail(`A board can have at most ${LIMITS.cardsPerBoard} cards`);
      }
      const card: Card = {
        id: op.id,
        columnId: op.columnId,
        title: op.title,
        description: '',
        labels: [],
        assigneeId: null,
        dueDate: null,
        pos: op.pos,
      };
      return { ok: true, state: { ...state, cards: { ...state.cards, [op.id]: card } } };
    }

    case 'card.update': {
      const card = state.cards[op.id];
      if (!card) return fail('Card no longer exists');
      // Only the fields named in the patch change, so two people editing
      // different fields of one card both keep their edit.
      const next: Card = { ...card };
      if (op.patch.title !== undefined) next.title = op.patch.title;
      if (op.patch.description !== undefined) next.description = op.patch.description;
      if (op.patch.labels !== undefined) next.labels = [...new Set(op.patch.labels)];
      if (op.patch.assigneeId !== undefined) next.assigneeId = op.patch.assigneeId;
      if (op.patch.dueDate !== undefined) next.dueDate = op.patch.dueDate;
      return { ok: true, state: { ...state, cards: { ...state.cards, [op.id]: next } } };
    }

    case 'card.move': {
      const card = state.cards[op.id];
      if (!card) return fail('Card no longer exists');
      if (!state.columns[op.columnId]) return fail('Column no longer exists');
      return {
        ok: true,
        state: {
          ...state,
          cards: { ...state.cards, [op.id]: { ...card, columnId: op.columnId, pos: op.pos } },
        },
      };
    }

    case 'card.delete': {
      if (!state.cards[op.id]) return fail('Card no longer exists');
      const cards = { ...state.cards };
      delete cards[op.id];
      return { ok: true, state: { ...state, cards } };
    }
  }
}

// ---- Selectors ------------------------------------------------------------

export function sortedColumns(state: BoardState): Column[] {
  return Object.values(state.columns).sort(byPos);
}

export function cardsInColumn(state: BoardState, columnId: string): Card[] {
  return Object.values(state.cards)
    .filter((card) => card.columnId === columnId)
    .sort(byPos);
}

// ---- Activity text --------------------------------------------------------

const quote = (text: string) => `“${text}”`;

/** Describes an operation in plain words, given the board as it was before the operation. */
export function describeOp(before: BoardState, op: Op): string {
  const cardTitle = (cardId: string) => quote(before.cards[cardId]?.title ?? 'a card');
  const columnTitle = (columnId: string) => quote(before.columns[columnId]?.title ?? 'a column');

  switch (op.type) {
    case 'board.rename':
      return `renamed the board to ${quote(op.title)}`;
    case 'column.add':
      return `added column ${quote(op.title)}`;
    case 'column.rename':
      return `renamed column ${columnTitle(op.id)} to ${quote(op.title)}`;
    case 'column.move':
      return `moved column ${columnTitle(op.id)}`;
    case 'column.delete':
      return `deleted column ${columnTitle(op.id)}`;
    case 'card.add':
      return `added ${quote(op.title)} to ${columnTitle(op.columnId)}`;
    case 'card.update': {
      const fields = Object.keys(op.patch);
      if (op.patch.title !== undefined && fields.length === 1) {
        return `renamed ${cardTitle(op.id)} to ${quote(op.patch.title)}`;
      }
      const names: Record<string, string> = {
        title: 'title',
        description: 'description',
        labels: 'labels',
        assigneeId: 'assignee',
        dueDate: 'due date',
      };
      return `changed the ${fields.map((f) => names[f] ?? f).join(' and ')} of ${cardTitle(op.id)}`;
    }
    case 'card.move': {
      const from = before.cards[op.id]?.columnId;
      return from === op.columnId
        ? `reordered ${cardTitle(op.id)} in ${columnTitle(op.columnId)}`
        : `moved ${cardTitle(op.id)} to ${columnTitle(op.columnId)}`;
    }
    case 'card.delete':
      return `deleted ${cardTitle(op.id)}`;
  }
}
