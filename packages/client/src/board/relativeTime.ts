import { useSyncExternalStore } from 'react';

const TICK_MS = 30_000;

// One clock shared by every comment time on the page, read from state rather
// than during render.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function refresh() {
  now = Date.now();
  for (const notify of listeners) notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    now = Date.now();
    timer = setInterval(refresh, TICK_MS);
    // Background tabs throttle intervals, so catch up as soon as the tab is back.
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

const getNow = () => now;

/** The current time, updated every half minute while anything is showing it. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getNow);
}

/** Same wording as the activity feed: "just now", "5 min ago", "3 h ago", then the date. */
export function relativeTime(at: number, nowMs: number): string {
  const minutes = Math.floor((nowMs - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
