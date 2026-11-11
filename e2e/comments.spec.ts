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

const thread = (page: Page) => page.getByRole('dialog').getByRole('region', { name: 'Comments' });

test('comments appear live for everyone and can be deleted', async ({ page, browser }) => {
  await startAsGuest(page);
  const friend = await inviteFriend(browser, page);
  const title = 'Write the launch announcement';

  // Both people open the same card.
  await card(page, title).click();
  await card(friend, title).click();
  await expect(thread(page).getByText('No comments yet')).toBeVisible();
  await expect(thread(friend).getByText('No comments yet')).toBeVisible();

  // Posting with the button; line breaks are kept and markup is shown as text.
  const box = page.getByLabel('Add a comment');
  await box.fill('Draft is ready.\n<b>Needs a review</b>');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(box).toHaveValue('');

  const posted = thread(friend).locator('.comment-body');
  await expect(posted).toHaveText('Draft is ready.\n<b>Needs a review</b>');
  await expect(thread(friend).locator('.comment-body b')).toHaveCount(0);
  await expect(thread(friend).locator('.comment time')).toHaveText('just now');
  await expect(thread(friend).getByText('No comments yet')).toHaveCount(0);

  // Ctrl+Enter posts as well.
  await friend.getByLabel('Add a comment').fill('On it.');
  await friend.getByLabel('Add a comment').press('Control+Enter');
  await expect(thread(page).locator('.comment-body')).toHaveText(['Draft is ready.\n<b>Needs a review</b>', 'On it.']);

  // The count shows on the card for both people.
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await friend.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(card(friend, title).getByLabel('2 comments')).toBeVisible();
  await expect(card(page, title).getByLabel('2 comments')).toBeVisible();

  // The friend may delete only their own comment; the owner may delete either.
  await card(friend, title).click();
  await expect(thread(friend).getByRole('button', { name: /^Delete comment by/ })).toHaveCount(1);
  await card(page, title).click();
  await expect(thread(page).getByRole('button', { name: /^Delete comment by/ })).toHaveCount(2);

  await thread(page).getByRole('button', { name: /^Delete comment by/ }).first().click();
  await thread(page).getByRole('button', { name: 'Keep it' }).click();
  await expect(thread(page).locator('.comment')).toHaveCount(2);

  await thread(page).getByRole('button', { name: /^Delete comment by/ }).first().click();
  await thread(page).getByRole('button', { name: 'Delete comment', exact: true }).click();
  await expect(thread(page).locator('.comment-body')).toHaveText(['On it.']);
  await expect(thread(friend).locator('.comment-body')).toHaveText(['On it.']);

  await friend.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(card(friend, title).getByLabel('1 comment', { exact: true })).toBeVisible();

  // A newcomer sees the count straight away.
  await friend.reload();
  await expect(card(friend, title).getByLabel('1 comment', { exact: true })).toBeVisible();
  await friend.context().close();
});
