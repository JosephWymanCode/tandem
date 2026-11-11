// Takes the README screenshots. Start the app first (npm run build && npm start),
// then: node scripts/screenshots.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:3000';
mkdirSync('docs', { recursive: true });

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
await ada.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

const ben = await (await browser.newContext({ viewport })).newPage();
await ben.goto(link);
await ben.getByRole('button', { name: 'Join as a guest' }).click();
await ben.getByRole('status').filter({ hasText: 'Live' }).waitFor();

// Give the board some life: an assignee, a few changes, a card held open by the second person.
await ada.locator('.card', { hasText: 'Redesign the onboarding' }).click();
await ada.getByLabel('Assigned to').selectOption({ index: 1 });
await ada.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
await ben.getByRole('region', { name: 'To do', exact: true }).getByRole('button', { name: 'Add a card' }).click();
await ben.getByLabel('New card in To do').fill('Draft the release notes');
await ben.keyboard.press('Enter');
await ben.keyboard.press('Escape');
await ben.locator('.card', { hasText: 'Write the launch announcement' }).click();
await ben.getByRole('button', { name: 'Blue', exact: true }).click();
await ben.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
await ben.locator('.card', { hasText: 'Check pricing page' }).click();
await ada.getByRole('button', { name: 'Activity', exact: true }).click();
await ben.mouse.move(690, 395);
await ben.mouse.move(700, 400);
await ada.mouse.move(420, 520);
await ada.waitForTimeout(500);
await ada.screenshot({ path: 'docs/board.png' });

await ben.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
await ada.locator('.card', { hasText: 'Redesign the onboarding' }).click();
await ada.waitForTimeout(300);
await ada.screenshot({ path: 'docs/card.png' });

await browser.close();
console.log('Saved docs/home.png, docs/board.png, docs/card.png');
