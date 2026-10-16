import { expect, test } from '@playwright/test';
import { hudValue, knobPos, skipOnboarding } from './helpers';

test('onboarding skip → measuring screen with estimate banner and a reading', async ({ page }) => {
  await skipOnboarding(page);
  await expect(page.getByTestId('stage')).toBeVisible();
  await expect(page.getByTestId('banner-estimate')).toBeVisible();
  await expect(page.getByTestId('hud')).toBeVisible();
  expect(await hudValue(page)).toMatch(/^\d+(\.\d)?mm$/);
});

test('dragging a marker changes the reading; undo restores it', async ({ page }) => {
  await skipOnboarding(page);
  const before = await hudValue(page);
  const b = await knobPos(page, 'b');
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.move(b.x + 40, b.y, { steps: 8 });
  await page.mouse.up();
  const after = await hudValue(page);
  expect(after).not.toBe(before);
  expect(parseFloat(after)).toBeGreaterThan(parseFloat(before));
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => hudValue(page)).toBe(before);
});

test('touches that start on empty canvas never move a tool (ghost touch shield)', async ({ page }) => {
  await skipOnboarding(page);
  const before = await hudValue(page);
  const b = await knobPos(page, 'b');
  // Start 60 px below the knob (empty canvas) and drag across it.
  await page.mouse.move(b.x, b.y + 140);
  await page.mouse.down();
  await page.mouse.move(b.x + 60, b.y, { steps: 8 });
  await page.mouse.up();
  expect(await hudValue(page)).toBe(before);
});

test('card calibration persists across reload, and a scale change triggers the guard', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByTestId('cal-chip').click();
  await page.getByTestId('cal-card').click();
  await expect(page.getByTestId('cal-panel')).toBeVisible();
  await page.getByTestId('cal-calc').click();
  await expect(page.getByTestId('cal-result')).toBeVisible();
  await page.getByTestId('cal-save').click();
  await expect(page.getByTestId('cal-chip')).toContainText('Calibrated');
  await expect(page.getByTestId('banner-estimate')).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('cal-chip')).toContainText('Calibrated');

  // Simulate Android "Display size" change: the stored profile no longer matches this screen.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('maapak');
        req.onsuccess = () => {
          const tx = req.result.transaction('profiles', 'readwrite');
          const store = tx.objectStore('profiles');
          const all = store.getAll();
          all.onsuccess = () => {
            for (const p of all.result)
              store.put({ ...p, deviceKey: { ...p.deviceKey, dpr: p.deviceKey.dpr + 0.5 } });
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await expect(page.getByTestId('banner-guard')).toBeVisible();
  await expect(page.getByTestId('banner-guard')).toContainText('Display scale changed');
});

test('edge setup locks and persists', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('./#/edges');
  await page.getByTestId('edges-lock').click();
  await expect(page.getByTestId('stage')).toBeVisible();
  await page.goto('./#/edges');
  await expect(page.getByTestId('edges-unlock')).toBeVisible();
});

test('save a measurement to a record', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByTestId('save-btn').click();
  await expect(page.getByTestId('save-dialog')).toBeVisible();
  await page.getByTestId('save-name').fill('Bolt-01');
  await page.getByTestId('save-confirm').click();
  await page.goto('./#/records');
  await expect(page.getByTestId('records-list')).toContainText('Bolt-01');
  await page.getByRole('button', { name: /Bolt-01/ }).click();
  await expect(page.getByTestId('record-detail')).toContainText('L1');
});

test('all gap/split/leapfrog modes render a reading', async ({ page }) => {
  await skipOnboarding(page);
  for (const id of ['gapRuler', 'splitRuler', 'leapfrog', 'free', 'ruler']) {
    await page.getByTestId(`dock-${id}`).click();
    await expect(page.getByTestId('hud-value')).toBeVisible();
  }
});

test('Hindi language switch', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('./#/settings');
  await page.getByRole('radio', { name: 'हिंदी' }).click();
  await expect(page.getByRole('heading', { name: 'सेटिंग्स' })).toBeVisible();
});

test('works offline after the first load', async ({ page, context }) => {
  await skipOnboarding(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('stage')).toBeVisible();
  await context.setOffline(false);
});
