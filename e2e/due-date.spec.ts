import { expect, test, type Browser, type Page } from '@playwright/test';

const card = (page: Page, title: string) => page.locator('.card', { hasText: title });

async function startAsGuest(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it as a guest' }).click();
  await expect(page).toHaveURL(/\/b\//);
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
}

/** Opens the first person's board in a separate browser profile, joined through the invite link. */
async function inviteFriend(browser: Browser, page: Page) {
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const link = await page.getByLabel('Invite link').inputValue();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const friend = await context.newPage();
  await friend.goto(link);
  await friend.getByRole('button', { name: 'Join as a guest' }).click();
  await expect(friend).toHaveURL(page.url());
  await expect(friend.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  return friend;
}

/** A date relative to the browser's own today, as YYYY-MM-DD. */
function dateFromToday(page: Page, days: number) {
  return page.evaluate((offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }, days);
}

test('a due date shows on the card for everyone and is highlighted when overdue', async ({ page, browser }) => {
  await startAsGuest(page);
  const friend = await inviteFriend(browser, page);
  const title = 'Agree the launch date';
  const badge = (on: Page) => card(on, title).locator('.due-badge');

  // Setting a date a couple of weeks out: a plain badge appears for the other person.
  await card(page, title).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Due date').fill(await dateFromToday(page, 14));
  await expect(badge(friend)).toBeVisible();
  await expect(badge(friend)).toContainText('Due');
  await expect(badge(friend)).not.toHaveClass(/due-overdue|due-soon/);

  // Tomorrow counts as due soon.
  await dialog.getByLabel('Due date').fill(await dateFromToday(page, 1));
  await expect(badge(friend)).toHaveClass(/due-soon/);

  // A date in the past is overdue.
  await dialog.getByLabel('Due date').fill(await dateFromToday(page, -3));
  await expect(badge(friend)).toHaveClass(/due-overdue/);
  await expect(badge(page)).toHaveClass(/due-overdue/);
  await expect(badge(friend)).toHaveAttribute('aria-label', /overdue$/);

  // Removing it removes the badge.
  await dialog.getByRole('button', { name: 'Remove due date' }).click();
  await expect(dialog.getByLabel('Due date')).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Remove due date' })).toHaveCount(0);
  await expect(badge(friend)).toHaveCount(0);
  await expect(badge(page)).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByLabel('Activity').getByText(`changed the due date of “${title}”`).first()).toBeVisible();
  await friend.context().close();
});
