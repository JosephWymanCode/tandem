import { useSyncExternalStore } from 'react';

/** How close a due date is, relative to today. */
export type DueStatus = 'overdue' | 'soon' | 'later';

/** Cards due today or within this many days count as due soon. */
export const DUE_SOON_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

function parts(date: string): [number, number, number] {
  return date.split('-').map(Number) as [number, number, number];
}

/** Today's date on this device as YYYY-MM-DD, in local time. */
export function localDateKey(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days from `today` to `due`; both are YYYY-MM-DD. Negative when the date has passed. */
export function daysUntil(due: string, today: string): number {
  const [dy, dm, dd] = parts(due);
  const [ty, tm, td] = parts(today);
  // Both go through UTC so daylight saving changes cannot add or lose an hour.
  return Math.round((Date.UTC(dy, dm - 1, dd) - Date.UTC(ty, tm - 1, td)) / DAY_MS);
}

export function dueStatus(due: string, today: string): DueStatus {
  const days = daysUntil(due, today);
  if (days < 0) return 'overdue';
  if (days <= DUE_SOON_DAYS) return 'soon';
  return 'later';
}

/**
 * Formats a stored YYYY-MM-DD date in the viewer's locale, for example
 * "14 Nov" or "Nov 14". The year is added when it is not this year.
 * The date is built from its parts in local time, so it never shifts by a day.
 */
export function formatDueDate(due: string, today: string, locale?: string): string {
  const [year, month, day] = parts(due);
  const sameYear = year === parts(today)[0];
  return new Date(year, month - 1, day).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// ---- Today's date, shared by every badge -------------------------------------

const REFRESH_MS = 60_000;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

/** Asks every badge to re-read the date. React only re-renders the ones whose date changed. */
function refresh() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    }
  };
}

/** The snapshot is a date string, so it stays equal all day and only changes at midnight. */
const getToday = () => localDateKey(new Date());

/**
 * The current local date as YYYY-MM-DD, from one shared store that checks
 * the clock every minute (and when the tab becomes visible), so badges
 * re-render when the day changes. Components never read the clock themselves.
 */
export function useToday(): string {
  return useSyncExternalStore(subscribe, getToday);
}
