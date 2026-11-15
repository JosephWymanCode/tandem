// Takes the README screenshots. Start the app first (npm run build && npm start),
// then: node scripts/screenshots.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:3000';
// A calendar date `days` from today, as the date input expects it.
const day = (days) => {
  const date = new Date(Date.now() + days * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
mkdirSync('docs', { recursive: true });
// The card dialog is taller than the window now, so close it the way a keyboard user would.
const close = async (page) => {
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
};

const browser = await chromium.launch();
const viewport = { width: 1280, height: 760 };

const ada = await (await browser.newContext({ viewport, deviceScaleFactor: 2 })).newPage();
await ada.goto(base);
await ada.waitForTimeout(3600);
await ada.screenshot({ path: 'docs/home.png' });

await ada.getByRole('button', { name: 'Try it as a guest' }).click();
await ada.getByRole('status').filter({ hasText: 'Live' }).waitFor();
await ada.getByRole('button', { name: 'Share', exact: true }).click();
const link = await ada.getByLabel('Invite link').inputValue();
await close(ada);

const ben = await (await browser.newContext({ viewport })).newPage();
await ben.goto(link);
await ben.getByRole('button', { name: 'Join as a guest' }).click();
await ben.getByRole('status').filter({ hasText: 'Live' }).waitFor();

// Give the board some life: an assignee, a few changes, a card held open by the second person.
await ada.locator('.card', { hasText: 'Redesign the onboarding' }).click();
await ada.getByLabel('Assigned to').selectOption({ index: 1 });
await ada.getByLabel('Due date').fill(day(2));
await ada.getByLabel('Add a comment').fill('Can we try the new flow with five people before we build it?');
await ada.getByRole('button', { name: 'Post comment' }).click();
await close(ada);
await ben.getByRole('region', { name: 'To do', exact: true }).getByRole('button', { name: 'Add a card' }).click();
await ben.getByLabel('New card in To do').fill('Draft the release notes');
await ben.keyboard.press('Enter');
await ben.keyboard.press('Escape');
await ben.locator('.card', { hasText: 'Write the launch announcement' }).click();
await ben.getByRole('button', { name: 'Blue', exact: true }).click();
await ben.getByLabel('Due date').fill(day(-1));
await close(ben);
await ben.locator('.card', { hasText: 'Redesign the onboarding' }).click();
await ben.getByLabel('Add a comment').fill('Yes. I can book them for Thursday.');
await ben.getByRole('button', { name: 'Post comment' }).click();
await close(ben);
await ben.locator('.card', { hasText: 'Check pricing page' }).click();
await ada.getByRole('button', { name: 'Activity', exact: true }).click();
await ben.mouse.move(690, 395);
await ben.mouse.move(700, 400);
await ada.mouse.move(420, 520);
await ada.waitForTimeout(500);
await ada.screenshot({ path: 'docs/board.png' });

await close(ben);
await ada.locator('.card', { hasText: 'Redesign the onboarding' }).click();
await ada.getByRole('dialog').getByLabel('Add a comment').scrollIntoViewIfNeeded();
await ada.waitForTimeout(300);
await ada.screenshot({ path: 'docs/card.png' });

// The dark theme, with a search narrowing the board.
await close(ada);
await ada.getByRole('button', { name: 'Activity', exact: true }).click();
await ada.getByLabel('Theme').selectOption('dark');
await ada.getByLabel('Search cards').fill('launch');
await ada.mouse.move(1200, 700);
await ada.waitForTimeout(400);
await ada.screenshot({ path: 'docs/dark.png' });

await browser.close();
console.log('Saved docs/home.png, docs/board.png, docs/card.png, docs/dark.png');
