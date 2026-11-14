import { expect, test, type Page } from '@playwright/test';

const lane = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true });
const card = (page: Page, title: string) => page.locator('.card', { hasText: title });
const notice = 'Guest boards can only be reached from this browser.';

async function startAsGuest(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it as a guest' }).click();
  await expect(page).toHaveURL(/\/b\//);
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
}

test('a guest creates an account and keeps their board', async ({ page }) => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `grace-${stamp}@example.com`;
  const taken = `taken-${stamp}@example.com`;
  const signup = await page.request.post('/api/auth/signup', {
    data: { name: 'Someone else', email: taken, password: 'correct horse battery' },
  });
  expect(signup.ok()).toBe(true);
  await page.context().clearCookies();

  await startAsGuest(page);
  const boardUrl = page.url();
  await lane(page, 'To do').getByRole('button', { name: 'Add a card' }).click();
  await page.getByLabel('New card in To do').fill('Keep me after upgrading');
  await page.keyboard.press('Enter');
  await expect(card(page, 'Keep me after upgrading')).toBeVisible();

  await page.getByRole('link', { name: 'All boards' }).click();
  await expect(page.getByText(notice, { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Create an account to keep your boards' }).click();
  const form = page.locator('.upgrade-form');
  await expect(form.getByLabel('Name', { exact: true })).toHaveValue(/^Guest /);
  await expect(form.getByText('At least 8 characters.')).toBeVisible();

  // An email that already has an account is refused inline.
  await form.getByLabel('Name', { exact: true }).fill('Grace Hopper');
  await form.getByLabel('Email', { exact: true }).fill(taken);
  // The password label also holds its hint, so it is matched by its start.
  await form.getByLabel(/^Password/).fill('correct horse battery');
  await form.getByRole('button', { name: 'Create account' }).click();
  await expect(form.getByRole('alert')).toHaveText('An account with this email already exists. Log in instead.');

  await form.getByLabel('Email', { exact: true }).fill(email);
  await form.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(notice, { exact: false })).toHaveCount(0);
  await expect(page.locator('.page-bar-user')).toContainText('Grace Hopper');

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('button', { name: 'Try it as a guest' })).toBeVisible();

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.locator('form').getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Your boards' })).toBeVisible();
  await expect(page.locator('.page-bar-user')).toContainText('Grace Hopper');
  await expect(page.getByText(notice, { exact: false })).toHaveCount(0);

  await page.getByRole('link', { name: /Website relaunch/ }).click();
  await expect(page).toHaveURL(boardUrl);
  await expect(card(page, 'Keep me after upgrading')).toBeVisible();
});
