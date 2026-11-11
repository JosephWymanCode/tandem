import { describe, expect, it } from 'vitest';
import { parseChoice, resolveTheme, THEME_CHOICES, THEME_COLOR, THEME_STORAGE_KEY } from '../src/theme';

describe('parseChoice', () => {
  it('keeps a stored light or dark choice', () => {
    expect(parseChoice('light')).toBe('light');
    expect(parseChoice('dark')).toBe('dark');
  });

  it('follows the system for anything else', () => {
    for (const value of [null, undefined, '', 'system', 'Dark', 'blue', 1, {}]) {
      expect(parseChoice(value)).toBe('system');
    }
  });
});

describe('resolveTheme', () => {
  it('uses an explicit choice whatever the system prefers', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the system preference for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

it('offers System, Light and Dark in that order', () => {
  expect(THEME_CHOICES.map((option) => option.label)).toEqual(['System', 'Light', 'Dark']);
});

it('the pre-paint script uses the same storage key and colours as the app', async () => {
  const { readFile } = await import('node:fs/promises');
  const script = await readFile(new URL('../public/theme-init.js', import.meta.url), 'utf8');
  expect(script).toContain(`'${THEME_STORAGE_KEY}'`);
  expect(script).toContain(`'${THEME_COLOR.light}'`);
  expect(script).toContain(`'${THEME_COLOR.dark}'`);
});

it('the browser bar colours match the --paper token of each theme', async () => {
  const { readFile } = await import('node:fs/promises');
  const light = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const dark = await readFile(new URL('../src/theme.css', import.meta.url), 'utf8');
  expect(light).toContain(`--paper: ${THEME_COLOR.light};`);
  expect(dark).toContain(`--paper: ${THEME_COLOR.dark};`);
});
