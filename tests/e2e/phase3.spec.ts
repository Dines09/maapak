import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './helpers';

/** A 600×400 PNG with a dark square in the middle (for the gallery-alignment test). */
async function testPng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 400;
    const x = c.getContext('2d')!;
    x.fillStyle = '#eee';
    x.fillRect(0, 0, 600, 400);
    x.fillStyle = '#222';
    x.fillRect(200, 100, 200, 200);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

// Desktop Edge supports Web Share; force the download fallback so files can be checked.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
});

async function saveCurrent(page: Page, name: string, recipe?: string) {
  await page.getByTestId('save-btn').click();
  await page.getByTestId('save-name').fill(name);
  if (recipe) await page.getByTestId('save-recipe').selectOption(recipe);
  await page.getByTestId('save-confirm').click();
  await expect(page.getByTestId('save-dialog')).toHaveCount(0);
}

test('record with a circle shows a dimensioned drawing and exports PDF / CSV / SVG', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByTestId('dock-circle').click();
  await saveCurrent(page, 'Ring-A');
  await page.goto('./#/records');
  await page.getByRole('button', { name: /Ring-A/ }).click();
  await expect(page.getByTestId('drawing')).toContainText('Ø');
  await page.getByTestId('export-btn').click();
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-pdf').click()]);
  expect(pdf.suggestedFilename()).toBe('Ring-A.pdf');
  const pdfPath = await pdf.path();
  expect((await import('node:fs')).statSync(pdfPath!).size).toBeGreaterThan(2000);
  await page.getByTestId('export-btn').click();
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
  expect((await import('node:fs')).readFileSync((await csv.path())!, 'utf8')).toContain('Ring-A');
  await page.getByTestId('export-btn').click();
  const [card] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-jpg').click()]);
  expect(card.suggestedFilename()).toBe('Ring-A.jpg');
});

test('gallery photo + manual ghost alignment puts dimensions on the photo', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByTestId('dock-box').click();
  await saveCurrent(page, 'Plate-1', 'rect');
  await page.goto('./#/records');
  await page.getByRole('button', { name: /Plate-1/ }).click();
  await expect(page.getByTestId('recipe')).toBeVisible();
  await page
    .getByTestId('gallery-input')
    .setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: await testPng(page) });
  await expect(page.getByTestId('align')).toBeVisible();
  await page.getByTestId('align-save').click();
  await expect(page.getByTestId('annotated-photo')).toBeVisible();
  await expect(page.getByTestId('annotated-photo').locator('text').first()).toBeAttached();
});

test('camera: ghost overlay over the (fake) live camera, then capture', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByTestId('dock-circle').click();
  await saveCurrent(page, 'Cam-1');
  await page.goto('./#/records');
  await page.getByRole('button', { name: /Cam-1/ }).click();
  await page.getByTestId('open-camera').click();
  await expect(page.getByTestId('camera')).toBeVisible();
  await expect(page.getByTestId('ghost')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('match-score')).toBeVisible();
  await page.getByRole('button', { name: 'Take photo' }).click();
  await expect(page.getByTestId('record-detail')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('annotated-photo')).toBeVisible();
});

test('records: CSV of all, backup zip, JSON round trip, compare, batch mode', async ({ page }) => {
  await skipOnboarding(page);
  await saveCurrent(page, 'Alpha');
  await page.getByTestId('dock-box').click();
  await saveCurrent(page, 'Beta');
  await page.goto('./#/records');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByTestId('csv-all').click()]);
  const text = (await import('node:fs')).readFileSync((await csv.path())!, 'utf8');
  expect(text).toContain('Alpha');
  expect(text).toContain('Beta');
  const [zip] = await Promise.all([page.waitForEvent('download'), page.getByTestId('backup').click()]);
  expect(zip.suggestedFilename()).toMatch(/\.maapak\.zip$/);

  // JSON export of Alpha, then import it back (gets a new id + "(import)").
  await page.getByRole('button', { name: /Alpha/ }).click();
  await page.getByTestId('export-btn').click();
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
  const jsonPath = (await json.path())!;
  await page.goto('./#/records');
  await page.getByTestId('import-json').setInputFiles(jsonPath);
  await expect(page.getByTestId('records-list')).toContainText('Alpha (import)');

  // Compare Alpha with Beta.
  await page
    .getByRole('button', { name: /^Alpha\b/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Compare' }).click();
  await page.getByRole('button', { name: /Beta/ }).click();
  await expect(page.getByTestId('compare')).toContainText('Δ');

  // Batch mode: Save goes straight to Bolt-01, Bolt-02.
  await page.keyboard.press('Escape');
  await page.getByTestId('batch-btn').click();
  await page.getByText('Batch mode — Save goes straight to the next record').click();
  await page.getByTestId('batch-prefix').fill('Bolt');
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.goto('./#/');
  await page.getByTestId('save-btn').click();
  await page.getByTestId('save-btn').click();
  await page.goto('./#/records');
  await expect(page.getByTestId('records-list')).toContainText('Bolt-01');
  await expect(page.getByTestId('records-list')).toContainText('Bolt-02');
});
