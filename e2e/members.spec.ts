import { expect, test, type Browser, type Page } from '@playwright/test';

async function startAsGuest(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it as a guest' }).click();
  await expect(page).toHaveURL(/\/b\//);
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
}

async function openShare(page: Page) {
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  return page.getByRole('dialog');
}

/** Opens the first person's board in a separate browser profile, joined through the invite link. */
async function inviteFriend(browser: Browser, page: Page) {
  const dialog = await openShare(page);
  const link = await dialog.getByLabel('Invite link').inputValue();
  await dialog.getByRole('button', { name: 'Done' }).click();

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const friend = await context.newPage();
  await friend.goto(link);
  await friend.getByRole('button', { name: 'Join as a guest' }).click();
  await expect(friend).toHaveURL(page.url());
  await expect(friend.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  return friend;
}

test('the owner removes someone, who loses the board at once', async ({ page, browser }) => {
  await startAsGuest(page);
  const friend = await inviteFriend(browser, page);
  await expect(page.getByText('2 here now')).toBeVisible();

  const dialog = await openShare(page);
  const people = dialog.getByRole('region', { name: 'People on this board' });
  await expect(people.getByRole('listitem')).toHaveCount(2);
  await expect(people.getByRole('listitem').first()).toContainText('(you)');
  await expect(people.getByRole('listitem').first()).toContainText('Owner');

  await people.getByRole('button', { name: /^Remove / }).click();
  await people.getByRole('button', { name: 'Remove from board' }).click();
  await expect(people.getByRole('listitem')).toHaveCount(1);

  await expect(friend.getByRole('heading', { name: 'This board isn’t available' })).toBeVisible();
  await friend.reload();
  await expect(friend.getByRole('heading', { name: 'This board isn’t available' })).toBeVisible();
  await expect(page.getByText('Only you')).toBeVisible();
  await friend.context().close();
});

test('a member leaves a board', async ({ page, browser }) => {
  await startAsGuest(page);
  const friend = await inviteFriend(browser, page);

  const dialog = await openShare(friend);
  const people = dialog.getByRole('region', { name: 'People on this board' });
  await expect(people.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Reset invite link' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Leave board' }).click();
  await dialog.getByRole('button', { name: 'Leave this board' }).click();

  await expect(friend.getByRole('heading', { name: 'Your boards' })).toBeVisible();
  await expect(friend).toHaveURL(/\/boards$/);
  await expect(friend.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByText('Only you')).toBeVisible();
  await friend.context().close();
});

test('resetting the invite link changes the link and retires the old one', async ({ page, browser }) => {
  await startAsGuest(page);
  const friend = await inviteFriend(browser, page);

  const dialog = await openShare(page);
  const oldLink = await dialog.getByLabel('Invite link').inputValue();
  await dialog.getByRole('button', { name: 'Reset invite link' }).click();
  await expect(dialog.getByText('The current link will stop working at once.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Reset link' }).click();
  await expect(dialog.getByLabel('Invite link')).not.toHaveValue(oldLink);
  const newLink = await dialog.getByLabel('Invite link').inputValue();

  // People already on the board see the new link too.
  const friendDialog = await openShare(friend);
  await expect(friendDialog.getByLabel('Invite link')).toHaveValue(newLink);

  const stranger = await browser.newContext().then((context) => context.newPage());
  await stranger.goto(oldLink);
  await expect(stranger.getByText('This invite link is not valid any more.')).toBeVisible();
  await stranger.goto(newLink);
  await expect(stranger.getByRole('button', { name: 'Join as a guest' })).toBeVisible();
  await Promise.all([friend.context().close(), stranger.context().close()]);
});
