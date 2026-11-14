import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function startAsGuest(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it as a guest' }).click();
  await expect(page).toHaveURL(/\/b\//);
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
}

/** Every lane's title and its cards' titles, in the order they appear on screen. */
async function boardContents(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  return page.locator('.lane').evaluateAll((lanes) =>
    lanes.map((lane) => ({
      title: lane.getAttribute('aria-label'),
      cards: [...lane.querySelectorAll('.card')].map((card) => card.textContent?.trim() ?? ''),
    })),
  );
}

async function chooseImportFile(page: Page, file: Parameters<import('@playwright/test').FileChooser['setFiles']>[0]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a board' }).click();
  await (await chooser).setFiles(file);
}

test('a board exported as JSON can be imported as a new board', async ({ page }, testInfo) => {
  await startAsGuest(page);
  const originalUrl = page.url();
  const original = await boardContents(page);
  expect(original.length).toBe(4);

  await page.getByRole('link', { name: 'All boards' }).click();
  await expect(page.getByRole('heading', { name: 'Your boards' })).toBeVisible();

  const exportGroup = page.getByRole('group', { name: 'Export Website relaunch', exact: true });
  const downloading = page.waitForEvent('download');
  await exportGroup.getByRole('link', { name: 'JSON', exact: true }).click();
  const download = await downloading;
  // The browser uses the full title from filename*, not the ASCII fallback.
  expect(download.suggestedFilename()).toBe('Website relaunch.json');
  const path = testInfo.outputPath('Website-relaunch.json');
  await download.saveAs(path);
  const exported = JSON.parse(await readFile(path, 'utf8')) as { format: string; columns: unknown[] };
  expect(exported.format).toBe('tandem-board');
  expect(exported.columns).toHaveLength(4);

  // The CSV link points at the same board in the other format.
  await expect(exportGroup.getByRole('link', { name: 'CSV', exact: true })).toHaveAttribute(
    'href',
    /\/export\?format=csv$/,
  );

  await chooseImportFile(page, path);
  await expect(page).toHaveURL(/\/b\//);
  expect(page.url()).not.toBe(originalUrl);
  await expect(page.getByRole('heading', { name: 'Website relaunch' })).toBeVisible();
  expect(await boardContents(page)).toEqual(original);

  // Both boards are now listed.
  await page.getByRole('link', { name: 'All boards' }).click();
  await expect(page.getByRole('link', { name: /^Website relaunch/ })).toHaveCount(2);
});

test('importing a file that is not a Tandem export shows an error', async ({ page }) => {
  await startAsGuest(page);
  await page.getByRole('link', { name: 'All boards' }).click();
  await expect(page.getByRole('heading', { name: 'Your boards' })).toBeVisible();

  await chooseImportFile(page, {
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ hello: 'world' })),
  });
  await expect(page.getByRole('alert')).toHaveText('This file is not a Tandem board export.');

  await chooseImportFile(page, { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{ nope') });
  await expect(page.getByRole('alert')).toHaveText('This file is not a Tandem board export.');

  await chooseImportFile(page, {
    name: 'big.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ format: 'tandem-board', version: 1, title: 'Big', columns: [], notes: 'x'.repeat(8 * 1024 * 1024) }),
    ),
  });
  await expect(page.getByRole('alert')).toHaveText('This file is too large to import. The limit is 8 MB.');

  await expect(page).toHaveURL(/\/boards$/);
  await expect(page.getByRole('listitem')).toHaveCount(1);
});
