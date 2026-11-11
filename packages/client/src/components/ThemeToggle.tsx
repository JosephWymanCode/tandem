import { useId, useSyncExternalStore } from 'react';
import { parseChoice, THEME_CHOICES } from '../theme';
import { getThemeChoice, setThemeChoice, subscribeTheme } from '../themeStore';
import './ThemeToggle.css';

/** A compact select for System, Light or Dark. `corner` pins it to the top right of pages without a top bar. */
export function ThemeToggle({ corner = false }: { corner?: boolean }) {
  const choice = useSyncExternalStore(subscribeTheme, getThemeChoice);
  const id = useId();

  return (
    <div className={corner ? 'theme-toggle theme-toggle-corner' : 'theme-toggle'}>
      <label htmlFor={id}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5Z" fill="currentColor" />
        </svg>
        <span className="theme-toggle-text">Theme</span>
      </label>
      <select id={id} value={choice} onChange={(event) => setThemeChoice(parseChoice(event.target.value))}>
        {THEME_CHOICES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
