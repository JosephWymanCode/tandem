import { expect, test, type Page } from '@playwright/test';

const LIGHT_PAPER = 'rgb(237, 241, 238)';
const DARK_PAPER = 'rgb(15, 29, 34)';

const theme = (page: Page) => page.locator('html').getAttribute('data-theme');
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

async function startAsGuest(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it as a guest' }).click();
  await expect(page).toHaveURL(/\/b\//);
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
}

test('choosing Dark darkens the board and survives a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await startAsGuest(page);
  const select = page.getByLabel('Theme');
  await expect(select).toHaveValue('system');
  expect(await theme(page)).toBe('light');
  expect(await background(page)).toBe(LIGHT_PAPER);

  await select.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await background(page)).toBe(DARK_PAPER);

  await page.reload();
  await expect(page.getByLabel('Theme')).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await background(page)).toBe(DARK_PAPER);

  // The choice is applied before the app loads too, on every page.
  await page.goto('/boards');
  await expect(page.getByRole('heading', { name: 'Your boards' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // An explicit Light wins over a dark system setting.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByLabel('Theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await background(page)).toBe(LIGHT_PAPER);
});

test('System follows the operating system setting as it changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByLabel('Theme')).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await background(page)).toBe(DARK_PAPER);

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await background(page)).toBe(LIGHT_PAPER);

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the page still works when storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('blocked');
      },
    });
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Try it as a guest' })).toBeVisible();
});
