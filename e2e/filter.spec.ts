import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

const lane = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true });
const card = (page: Page, title: string) => page.locator('.card', { hasText: title });
const bar = (page: Page) => page.getByRole('search');

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

test('searching narrows the cards and clearing brings them back', async ({ page }) => {
  await startAsGuest(page);
  await expect(page.locator('.card')).toHaveCount(10);
  await expect(bar(page).getByRole('button', { name: 'Clear filters' })).toHaveCount(0);

  // "/" jumps to the search box; the search covers titles and descriptions, in any case.
  await page.keyboard.press('/');
  await expect(page.getByLabel('Search cards')).toBeFocused();
  await page.keyboard.type('LAUNCH');
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(card(page, 'Write the launch announcement')).toBeVisible();
  await expect(card(page, 'Agree the launch date')).toBeVisible();
  await expect(lane(page, 'To do').locator('.lane-count')).toHaveText('1 of 3');
  await expect(lane(page, 'Start here').locator('.lane-count')).toHaveText('0 of 3');

  await page.getByLabel('Search cards').fill('overflows below');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(card(page, 'Check pricing page on small phones')).toBeVisible();

  // Escape empties the search box.
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Search cards')).toHaveValue('');
  await expect(page.locator('.card')).toHaveCount(10);
  await expect(lane(page, 'To do').locator('.lane-count')).toHaveText('3');

  // Nothing matches: a message offers the way back.
  await page.getByLabel('Search cards').fill('no such card anywhere');
  await expect(page.locator('.card')).toHaveCount(0);
  const empty = page.getByRole('status').filter({ hasText: 'No cards match' });
  await expect(empty).toBeVisible();
  await empty.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.card')).toHaveCount(10);
  await expect(empty).toHaveCount(0);

  // Typing "/" in a field types a slash instead of jumping away.
  await lane(page, 'Done').getByRole('button', { name: 'Add a card' }).click();
  await page.keyboard.type('a/b');
  await expect(page.getByLabel('New card in Done')).toHaveValue('a/b');
});

test('label and assignee filters work together and clear in one go', async ({ page }) => {
  await startAsGuest(page);

  // Assign one card to yourself so there is something to tell apart.
  await card(page, 'Set up error reporting').click();
  const me = await page.getByLabel('Assigned to').locator('option').nth(1).getAttribute('value');
  await page.getByLabel('Assigned to').selectOption(me!);
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

  await bar(page).getByRole('button', { name: /^Filter/ }).click();
  const popover = page.getByRole('dialog', { name: 'Filter cards' });
  await popover.getByRole('button', { name: 'Amber', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(card(page, 'Write the launch announcement')).toBeVisible();
  await expect(card(page, 'Move image uploads to background jobs')).toBeVisible();

  // A second label widens the match: a card needs only one of them.
  await popover.getByRole('button', { name: 'Green', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(4);
  await expect(lane(page, 'Done').locator('.lane-count')).toHaveText('1 of 2');

  // Adding an assignee narrows it again.
  await popover.getByLabel('Assigned to').selectOption(me!);
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(card(page, 'Set up error reporting')).toBeVisible();
  await popover.getByLabel('Assigned to').selectOption('none');
  await expect(page.locator('.card')).toHaveCount(3);
  await expect(card(page, 'Set up error reporting')).toHaveCount(0);

  // Search and filters combine, and the popover closes when focus leaves it.
  await page.getByLabel('Search cards').fill('drag');
  await expect(popover).toHaveCount(0);
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(card(page, 'Drag me to another column')).toBeVisible();

  await bar(page).getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.card')).toHaveCount(10);
  await expect(page.getByLabel('Search cards')).toHaveValue('');
  await expect(bar(page).getByRole('button', { name: 'Clear filters' })).toHaveCount(0);

  // The filter does not follow you off the board and back.
  await page.getByLabel('Search cards').fill('launch');
  await expect(page.locator('.card')).toHaveCount(2);
  await page.getByRole('link', { name: 'All boards' }).click();
  await expect(page).toHaveURL(/\/boards$/);
  await page.goBack();
  await expect(page.locator('.card')).toHaveCount(10);
  await expect(page.getByLabel('Search cards')).toHaveValue('');
});

test('a filter is private, and dragging while filtered lands where it looks', async ({ page, browser }) => {
  await startAsGuest(page);
  const friend = await inviteFriend(browser, page);

  await lane(page, 'To do').getByRole('button', { name: 'Add a card' }).click();
  await page.getByLabel('New card in To do').fill('Print the handouts');
  await page.keyboard.press('Enter');
  await expect(card(friend, 'Print the handouts')).toBeVisible();

  // "nt" hides the pricing card, which sits between the first and third cards.
  await page.getByLabel('Search cards').fill('nt');
  await expect(lane(page, 'To do').locator('.card-title')).toHaveText([
    'Write the launch announcement',
    'Book the user interviews for next week',
    'Print the handouts',
  ]);
  await expect(lane(page, 'To do').locator('.lane-count')).toHaveText('3 of 4');

  // The other person still sees everything.
  await expect(friend.locator('.card')).toHaveCount(11);
  await expect(friend.getByLabel('Search cards')).toHaveValue('');
  await expect(lane(friend, 'To do').locator('.lane-count')).toHaveText('4');

  // Move the last card up to second place among the visible ones.
  await drag(page, card(page, 'Print the handouts'), card(page, 'Book the user interviews'));
  await expect(lane(page, 'To do').locator('.card-title')).toHaveText([
    'Write the launch announcement',
    'Print the handouts',
    'Book the user interviews for next week',
  ]);

  // For everyone it sits directly under the card it was dropped below, ahead of the hidden one.
  const everyone = [
    'Write the launch announcement',
    'Print the handouts',
    'Check pricing page on small phones',
    'Book the user interviews for next week',
  ];
  await expect(lane(friend, 'To do').locator('.card-title')).toHaveText(everyone);

  await bar(page).getByRole('button', { name: 'Clear filters' }).click();
  await expect(lane(page, 'To do').locator('.card-title')).toHaveText(everyone);
  await friend.context().close();
});
