import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

const lane = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true });
const card = (page: Page, title: string) => page.locator('.card', { hasText: title });
const undoButton = (page: Page) => page.getByRole('button', { name: 'Undo', exact: true });
const redoButton = (page: Page) => page.getByRole('button', { name: 'Redo', exact: true });

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

/** Presses a shortcut with nothing focused, the way someone would after clicking the board. */
async function press(page: Page, keys: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(keys);
}

test('undo and redo a card move with the keyboard, seen by the other person too', async ({ page, browser }) => {
  await startAsGuest(page);
  const friend = await inviteFriend(browser, page);
  await expect(undoButton(page)).toBeDisabled();
  await expect(redoButton(page)).toBeDisabled();

  await drag(page, card(page, 'Drag me to another column'), card(page, 'Set up error reporting'));
  await expect(lane(page, 'Done').locator('.card', { hasText: 'Drag me' })).toBeVisible();
  await expect(lane(friend, 'Done').locator('.card', { hasText: 'Drag me' })).toBeVisible();
  await expect(undoButton(page)).toBeEnabled();

  await press(page, 'Control+z');
  await expect(lane(page, 'Start here').locator('.card', { hasText: 'Drag me' })).toBeVisible();
  await expect(lane(friend, 'Start here').locator('.card', { hasText: 'Drag me' })).toBeVisible();
  await expect(lane(friend, 'Start here').locator('.card').nth(1)).toContainText('Drag me');
  await expect(undoButton(page)).toBeDisabled();
  await expect(redoButton(page)).toBeEnabled();

  await press(page, 'Control+y');
  await expect(lane(page, 'Done').locator('.card', { hasText: 'Drag me' })).toBeVisible();
  await expect(lane(friend, 'Done').locator('.card', { hasText: 'Drag me' })).toBeVisible();
  await expect(redoButton(page)).toBeDisabled();

  // Ctrl+Shift+Z redoes as well, and the buttons do the same as the keys.
  await undoButton(page).click();
  await expect(lane(friend, 'Start here').locator('.card', { hasText: 'Drag me' })).toBeVisible();
  await press(page, 'Control+Shift+z');
  await expect(lane(friend, 'Done').locator('.card', { hasText: 'Drag me' })).toBeVisible();

  // The undo shows up in the activity feed like any other change.
  await undoButton(page).click();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const undos = page.getByLabel('Activity').getByText('moved “Drag me to another column” to “Start here”');
  await expect(undos).toHaveCount(3);
  await friend.context().close();
});

test('undo brings back a deleted column with its cards', async ({ page }) => {
  await startAsGuest(page);
  const column = lane(page, 'In progress');
  await expect(column.locator('.card')).toHaveCount(2);
  await column.getByRole('button', { name: 'Delete column In progress' }).click();
  await column.getByRole('alertdialog').getByRole('button', { name: 'Delete column' }).click();
  await expect(lane(page, 'In progress')).toHaveCount(0);

  await press(page, 'Control+z');
  await expect(lane(page, 'In progress').locator('.card')).toHaveCount(2);
  const restored = card(page, 'Redesign the onboarding checklist');
  await expect(restored.locator('.card-labels i')).toHaveCount(2);
  await restored.click();
  await expect(page.getByRole('dialog').getByLabel('Description')).toHaveValue(/Cut it from seven steps to four/);
  // While a dialog is open the shortcut is left alone.
  await press(page, 'Control+y');
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(lane(page, 'In progress')).toBeVisible();
  // The order of the lanes is as before.
  await expect(page.locator('.lane').nth(2)).toHaveAttribute('aria-label', 'In progress');
});

test('undo only reverses your own changes', async ({ page, browser }) => {
  await startAsGuest(page);
  const friend = await inviteFriend(browser, page);

  // I add a card; then my friend renames a column.
  await lane(page, 'To do').getByRole('button', { name: 'Add a card' }).click();
  await page.getByLabel('New card in To do').fill('Mine to undo');
  await page.keyboard.press('Enter');
  await expect(card(friend, 'Mine to undo')).toBeVisible();
  await page.keyboard.press('Escape');

  await lane(friend, 'Done').getByRole('button', { name: 'Done', exact: true }).click();
  await friend.getByLabel('Column name').fill('Shipped');
  await friend.keyboard.press('Enter');
  await expect(lane(page, 'Shipped')).toBeVisible();

  // Undo removes my card and leaves the friend's rename alone.
  await press(page, 'Control+z');
  await expect(card(page, 'Mine to undo')).toHaveCount(0);
  await expect(card(friend, 'Mine to undo')).toHaveCount(0);
  await expect(lane(page, 'Shipped')).toBeVisible();
  await expect(lane(friend, 'Shipped')).toBeVisible();
  await expect(undoButton(page)).toBeDisabled();

  // My friend's own undo reverses their rename, not my change.
  await press(friend, 'Control+z');
  await expect(lane(page, 'Done')).toBeVisible();
  await expect(card(page, 'Mine to undo')).toHaveCount(0);
  await friend.context().close();
});

test('the shortcut leaves text fields to the browser', async ({ page }) => {
  await startAsGuest(page);
  await lane(page, 'To do').getByRole('button', { name: 'To do', exact: true }).click();
  await page.getByLabel('Column name').fill('Next up');
  await page.keyboard.press('Enter');
  await expect(lane(page, 'Next up')).toBeVisible();

  await page.getByRole('button', { name: 'Website relaunch' }).click();
  const input = page.getByLabel('Board name');
  await input.press('End');
  await input.pressSequentially(' 2');
  await input.press('Control+z');
  // The column rename is untouched by Ctrl+Z inside the field.
  await expect(lane(page, 'Next up')).toBeVisible();
  await input.press('Escape');
  await press(page, 'Control+z');
  await expect(lane(page, 'To do')).toBeVisible();
});
