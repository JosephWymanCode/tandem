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
let today = localDateKey(new Date());
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function refresh() {
  const next = localDateKey(new Date());
  if (next === today) return;
  today = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    // The page may have sat in the background past midnight with nothing listening.
    refresh();
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

const getToday = () => today;

/**
 * The current local date as YYYY-MM-DD. It is held in one shared store that
 * checks the clock every minute, so components re-render when the day
 * changes without reading the clock during render.
 */
export function useToday(): string {
  return useSyncExternalStore(subscribe, getToday);
}
