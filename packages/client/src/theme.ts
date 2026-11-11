/**
 * Pure theme logic, shared by the store and the tests.
 * public/theme-init.js repeats the same rules (it runs before the bundle loads), so keep them in step.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'tandem-theme';

export const THEME_CHOICES: readonly { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** The browser bar colour for each theme, matching --paper. */
export const THEME_COLOR: Record<Theme, string> = { light: '#edf1ee', dark: '#0f1d22' };

/** Anything unexpected (nothing stored, an old or hand-edited value) means "follow the system". */
export function parseChoice(value: unknown): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): Theme {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light';
  return choice;
}
