import { parseChoice, resolveTheme, THEME_COLOR, THEME_STORAGE_KEY, type Theme, type ThemeChoice } from './theme';

// The chosen theme lives in localStorage, which can be missing or throw (private windows, blocked
// site data), so every access is guarded and the app falls back to following the system.

function readChoice(): ThemeChoice {
  try {
    return parseChoice(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

function writeChoice(choice: ThemeChoice) {
  try {
    if (choice === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Not remembered, but still applied for this visit.
  }
}

let choice: ThemeChoice = 'system';
let media: MediaQueryList | null = null;
const listeners = new Set<() => void>();

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

function apply() {
  applyTheme(resolveTheme(choice, media?.matches ?? false));
}

function update(next: ThemeChoice) {
  if (next === choice) return;
  choice = next;
  apply();
  listeners.forEach((listener) => listener());
}

/** Called once at start-up: applies the theme and keeps following the system and other tabs. */
export function startTheme() {
  choice = readChoice();
  media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', () => {
    if (choice === 'system') apply();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) update(readChoice());
  });
  apply();
}

export function getThemeChoice(): ThemeChoice {
  return choice;
}

export function setThemeChoice(next: ThemeChoice) {
  writeChoice(next);
  update(next);
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
