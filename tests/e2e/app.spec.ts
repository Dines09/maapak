import { expect, test } from '@playwright/test';
import { hudValue, knobPos, skipOnboarding, toolKind, touch } from './helpers';

test('onboarding skip → clean measuring screen: small ⚠, compact reading pill', async ({ page }) => {
  await skipOnboarding(page);
  await expect(page.getByTestId('stage')).toBeVisible();
  await expect(page.getByTestId('cal-warning')).toBeVisible();
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect(page.getByTestId('hud-panel')).toHaveCount(0);
  expect(await hudValue(page)).toMatch(/^\d+(\.\d)?mm$/);
  // Tap the pill to expand, tap again to collapse.
  await page.getByTestId('hud-pill').click();
  await expect(page.getByTestId('hud-panel')).toBeVisible();
  await page.getByTestId('hud-pill').click();
  await expect(page.getByTestId('hud-panel')).toHaveCount(0);
  // The ⚠ opens a small popover with the calibrate action.
  await page.getByTestId('cal-warning').click();
  await expect(page.getByTestId('cal-popover')).toBeVisible();
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
  expect(parseFloat(after)).toBeGreaterThan(parseFloat(before));
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => hudValue(page)).toBe(before);
});

test('touches that start on empty canvas never move a tool (ghost touch shield)', async ({ page }) => {
  await skipOnboarding(page);
  const before = await hudValue(page);
  const b = await knobPos(page, 'b');
  await page.mouse.move(b.x, b.y + 140);
  await page.mouse.down();
  await page.mouse.move(b.x + 60, b.y, { steps: 8 });
  await page.mouse.up();
  expect(await hudValue(page)).toBe(before);
});

test('two fingers held on empty glass drop gap rulers there', async ({ page }) => {
  await skipOnboarding(page);
  await touch(page, 'pointerdown', 11, 200, 190);
  await touch(page, 'pointerdown', 12, 220, 560);
  await page.waitForTimeout(800);
  await touch(page, 'pointerup', 11, 200, 190);
  await touch(page, 'pointerup', 12, 220, 560);
  await expect.poll(() => toolKind(page)).toBe('gapRuler');
});

test('card calibration persists across reload, and a scale change triggers the guard', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByTestId('cal-warning').click();
  await page
    .getByTestId('cal-popover')
    .getByRole('button', { name: /Calibrate now/ })
    .click();
  await page.getByTestId('cal-card').click();
  await expect(page.getByTestId('cal-panel')).toBeVisible();
  await page.getByTestId('cal-calc').click();
  await expect(page.getByTestId('cal-result')).toBeVisible();
  await page.getByTestId('cal-save').click();
  await expect(page.getByTestId('cal-chip')).toBeVisible();
  await expect(page.getByTestId('cal-warning')).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('cal-chip')).toBeVisible();

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

test('save a measurement to a record (with tolerance and repeats)', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByTestId('hud-pill').click();
  await page.getByTestId('hud-tol-btn').click();
  await page.getByTestId('tol-apply').click();
  await expect(page.getByTestId('hud-tol')).toBeVisible();
  await page.getByTestId('hud-rep-btn').click();
  await page.getByTestId('hud-rep-btn').click();
  await expect(page.getByTestId('hud-repeat')).toContainText('n=2');
  await page.getByTestId('save-btn').click();
  await page.getByTestId('save-name').fill('Bolt-01');
  await page.getByTestId('save-confirm').click();
  await page.goto('./#/records');
  await page.getByRole('button', { name: /Bolt-01/ }).click();
  await expect(page.getByTestId('record-detail')).toContainText('L1');
});

test('every dock tool shows a reading', async ({ page }) => {
  await skipOnboarding(page);
  for (const id of [
    'box',
    'gapRuler',
    'leapfrog',
    'caliper',
    'protractor',
    'circle',
    'hex',
    'rect',
    'ruler',
  ]) {
    await page.getByTestId(`dock-${id}`).click();
    await expect.poll(() => toolKind(page)).toBe(id);
    await expect(page.getByTestId('hud-value')).not.toHaveText('');
  }
  await page.getByTestId('dock-more').click();
  await page.getByTestId('more-polygon').click();
  await expect.poll(() => toolKind(page)).toBe('polygon');
});

test('leapfrog: big MARK button adds segments', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByTestId('dock-leapfrog').click();
  const one = parseFloat(await hudValue(page));
  await page.getByTestId('leap-mark').click();
  await expect(page.getByTestId('leap-bar')).toContainText('1');
  await expect.poll(async () => parseFloat(await hudValue(page))).toBeGreaterThan(one * 1.9);
});

test('quick shapes place pre-configured tools; caliper learn mode checks the reading', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByTestId('dock-shapes').click();
  await page.getByTestId('shape-oring').click();
  await expect.poll(() => toolKind(page)).toBe('circle');
  await expect(page.getByTestId('hud-value')).toBeVisible();

  await page.getByTestId('dock-caliper').click();
  await page.getByTestId('rail-opts').click();
  await page.getByTestId('opt-learn').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('learn')).toBeVisible();
  await expect(page.getByTestId('hud-value')).toHaveText('?mm');
  await page.getByTestId('learn-input').fill('0');
  await page.getByTestId('learn').getByRole('button', { name: 'Check' }).click();
  await expect(page.getByTestId('learn-verdict')).toContainText('Main scale');
});

test('lens pins and the arrow pad can move it', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByTestId('rail-lens').click();
  await expect(page.getByTestId('nudge-pad')).toBeVisible();
  const f0 = await page.evaluate(
    () => (window as unknown as { __maapak: { pinned: { focus: number[] } } }).__maapak.pinned.focus[0],
  );
  await page.getByRole('button', { name: 'Nudge right' }).click();
  const f1 = await page.evaluate(
    () => (window as unknown as { __maapak: { pinned: { focus: number[] } } }).__maapak.pinned.focus[0],
  );
  expect(f1).toBeGreaterThan(f0);
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
