import { create } from 'zustand';
import { keyBetween, type Card, type Label } from '@tandem/shared';

/** What one person has chosen to look at. Never sent to the server or to other people. */
export interface CardFilter {
  query: string;
  /** Selected label names. A card matches if it carries at least one of them. */
  labels: Label[];
  /** A member id, 'none' for cards nobody is assigned to, or null for any. */
  assignee: string | null;
}

export const NO_FILTER: CardFilter = { query: '', labels: [], assignee: null };

export function isFiltering(filter: CardFilter): boolean {
  return filter.query.trim() !== '' || filter.labels.length > 0 || filter.assignee !== null;
}

export function matches(card: Pick<Card, 'title' | 'description' | 'labels' | 'assigneeId'>, filter: CardFilter): boolean {
  const query = filter.query.trim().toLowerCase();
  if (query && !card.title.toLowerCase().includes(query) && !card.description.toLowerCase().includes(query)) {
    return false;
  }
  if (filter.labels.length > 0 && !filter.labels.some((label) => card.labels.includes(label))) return false;
  if (filter.assignee === 'none') return card.assigneeId === null;
  if (filter.assignee !== null) return card.assigneeId === filter.assignee;
  return true;
}

/**
 * The position for a card dropped into a column while some of its cards may be
 * hidden by a filter. `column` is the FULL column in order; `aboveId` is the
 * visible card the dropped card should sit directly under, or null when it was
 * dropped first. The card lands immediately after `aboveId`, ahead of any hidden
 * cards that follow it, so what the person sees is what everyone gets.
 */
export function dropPosition(
  column: readonly { id: string; pos: string }[],
  cardId: string,
  aboveId: string | null,
): string {
  const others = column.filter((card) => card.id !== cardId);
  if (aboveId === null) return keyBetween(null, others[0]?.pos ?? null);
  const index = others.findIndex((card) => card.id === aboveId);
  // The card above has just been moved or deleted by someone else: go to the end.
  if (index < 0) return keyBetween(others[others.length - 1]?.pos ?? null, null);
  return keyBetween(others[index]!.pos, others[index + 1]?.pos ?? null);
}

interface FilterStore extends CardFilter {
  setQuery: (query: string) => void;
  toggleLabel: (label: Label) => void;
  setAssignee: (assignee: string | null) => void;
  clear: () => void;
}

export const useFilter = create<FilterStore>((set) => ({
  ...NO_FILTER,
  setQuery: (query) => set({ query }),
  toggleLabel: (label) =>
    set((state) => ({
      labels: state.labels.includes(label) ? state.labels.filter((other) => other !== label) : [...state.labels, label],
    })),
  setAssignee: (assignee) => set({ assignee }),
  clear: () => set(NO_FILTER),
}));
