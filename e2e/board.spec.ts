import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

const lane = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true });
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

async function drag(page: Page, from: Locator, to: Locator) {
  const start = (await from.boundingBox())!;
  const end = (await to.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 12, start.y + start.height / 2 + 6, { steps: 3 });
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2 + 2, { steps: 2 });
  await page.mouse.up();
}

test('a guest lands on a working starter board', async ({ page }) => {
  await startAsGuest(page);
  await expect(page.getByRole('heading', { name: 'Website relaunch' })).toBeVisible();
  await expect(lane(page, 'Start here').locator('.card')).toHaveCount(3);
  await expect(page.getByText('Only you')).toBeVisible();
});

test('two people see each other’s changes as they happen', async ({ page, browser }) => {
  await startAsGuest(page);
  const friend = await inviteFriend(browser, page);
  await expect(page.getByText('2 here now')).toBeVisible();
  await expect(friend.getByText('2 here now')).toBeVisible();

  // Adding a card
  await lane(page, 'To do').getByRole('button', { name: 'Add a card' }).click();
  await page.getByLabel('New card in To do').fill('Ship the beta');
  await page.keyboard.press('Enter');
  await expect(card(friend, 'Ship the beta')).toBeVisible();

  // Dragging a card to another column
  await drag(page, card(page, 'Drag me to another column'), card(page, 'Set up error reporting'));
  await expect(lane(page, 'Done').locator('.card', { hasText: 'Drag me' })).toBeVisible();
  await expect(lane(friend, 'Done').locator('.card', { hasText: 'Drag me' })).toBeVisible();
  await expect(lane(friend, 'Start here').locator('.card')).toHaveCount(2);

  // Editing a card: the other person sees who has it open, then the result
  await card(friend, 'Ship the beta').click();
  await expect(page.locator('.card.is-edited', { hasText: 'Ship the beta' })).toBeVisible();
  await friend.getByLabel('Title').fill('Ship the public beta');
  await friend.getByRole('button', { name: 'Red', exact: true }).click();
  await friend.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(card(page, 'Ship the public beta')).toBeVisible();
  await expect(card(page, 'Ship the public beta').locator('.card-labels i')).toHaveCount(1);
  await expect(page.locator('.card.is-edited')).toHaveCount(0);

  // Renaming a column and the activity feed
  await lane(friend, 'To do').getByRole('button', { name: 'To do', exact: true }).click();
  await friend.getByLabel('Column name').fill('Up next');
  await friend.keyboard.press('Enter');
  await expect(lane(page, 'Up next')).toBeVisible();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByLabel('Activity').getByText('renamed column “To do” to “Up next”')).toBeVisible();

  // Live cursors
  await friend.mouse.move(400, 300);
  await friend.mouse.move(420, 320);
  await expect(page.locator('.cursor')).toBeVisible();

  await friend.context().close();
  await expect(page.getByText('Only you')).toBeVisible();
});

test('changes made while disconnected are sent after reconnecting', async ({ page, browser }) => {
  await startAsGuest(page);
  const friend = await inviteFriend(browser, page);

  // Hold the connection down while making a change.
  let offline = true;
  await page.routeWebSocket(/\/ws/, (socket) => {
    if (offline) void socket.close();
    else socket.connectToServer();
  });
  await page.evaluate(() => (window as any).__tandemDropConnection());
  await expect(page.getByRole('status').filter({ hasText: 'Reconnecting' })).toBeVisible();

  await lane(page, 'Done').getByRole('button', { name: 'Add a card' }).click();
  await page.getByLabel('New card in Done').fill('Written offline');
  await page.keyboard.press('Enter');
  await expect(card(page, 'Written offline')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '1 change waiting' })).toBeVisible();
  await expect(card(friend, 'Written offline')).toHaveCount(0);

  // Meanwhile the other person keeps working.
  await lane(friend, 'Done').getByRole('button', { name: 'Add a card' }).click();
  await friend.getByLabel('New card in Done').fill('Added meanwhile');
  await friend.keyboard.press('Enter');

  offline = false;
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible({ timeout: 15_000 });
  await expect(card(friend, 'Written offline')).toBeVisible();
  await expect(card(page, 'Added meanwhile')).toBeVisible();
  await friend.context().close();
});

test('accounts: sign up, log out, log in, create and delete a board', async ({ page }) => {
  const email = `ada-${Date.now()}@example.com`;
  await page.goto('/');
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Name').fill('Ada Lovelace');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.locator('form').getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/b\//);

  await page.getByRole('link', { name: 'All boards' }).click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('button', { name: 'Try it as a guest' })).toBeVisible();

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('wrong password');
  await page.locator('form').getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');

  await page.getByLabel('Password').fill('correct horse battery');
  await page.locator('form').getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Your boards' })).toBeVisible();

  await page.getByLabel('New board').fill('Roadmap');
  await page.getByRole('button', { name: 'Create board' }).click();
  await expect(page.getByRole('heading', { name: 'Roadmap' })).toBeVisible();
  await expect(page.locator('.lane')).toHaveCount(3);

  await page.getByRole('link', { name: 'All boards' }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'Roadmap' });
  await row.getByRole('button', { name: 'Delete' }).click();
  await row.getByRole('button', { name: 'Delete board' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(1);
});
