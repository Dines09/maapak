import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding, toolKind } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
});

async function openMore(page: Page, id: string) {
  await page.getByTestId('dock-more').click();
  await page.getByTestId(`more-${id}`).click();
}

test('specialty tools open from More and show readouts', async ({ page }) => {
  await skipOnboarding(page);
  for (const [id, tool] of [
    ['threadGauge', 'threadGauge'],
    ['wireGauge', 'wireGauge'],
    ['radiusGauge', 'radiusGauge'],
    ['gasket', 'gasket'],
    ['pcd', 'gasket'],
    ['datumXY', 'datumXY'],
    ['grid', 'grid'],
  ] as const) {
    await openMore(page, id);
    expect(await toolKind(page)).toBe(tool);
    await expect(page.getByTestId('hud-value')).toBeVisible();
  }
});

test('Bolt Wizard: head type → guided steps → result card with a bolt drawing', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByTestId('dock-shapes').click();
  await page.getByTestId('shape-nutBolt').click();
  await page.getByTestId('bolt-head-hex').click();
  await expect(page).toHaveURL(/into=.+&step=0/);
  await expect(page.getByTestId('into-chip')).toBeVisible();
  expect(await toolKind(page)).toBe('ruler');
  // Step 1 (length) → saved, wizard moves straight on to the shank step.
  await page.getByTestId('save-btn').click();
  await expect(page).toHaveURL(/step=1/);
  expect(await toolKind(page)).toBe('caliper');
  await page.getByTestId('save-btn').click();
  await expect(page).toHaveURL(/step=2/);
  // Jump to the record: result card and drawing.
  const id = /into=([^&]+)/.exec(page.url())![1];
  await page.goto(`./#/records/${id}`);
  await expect(page.getByTestId('bolt-card')).toBeVisible();
  await expect(page.getByTestId('bolt-title')).toContainText('Hex head bolt');
  await expect(page.getByTestId('drawing')).toBeVisible();
  // DXF export
  await page.getByTestId('export-btn').click();
  const [dxf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-dxf').click()]);
  expect(dxf.suggestedFilename()).toMatch(/\.dxf$/);
  const text = (await import('node:fs')).readFileSync((await dxf.path())!, 'utf8');
  expect(text).toContain('ENTITIES');
  expect(text.trim().endsWith('EOF')).toBe(true);
  // Template / match mode from the record
  await page.getByTestId('export-btn').click();
  await page.getByTestId('export-match').click();
  await expect.poll(() => toolKind(page)).toBe('template');
});

test('What is this? lists matches for the current tool', async ({ page }) => {
  await skipOnboarding(page);
  await page.getByTestId('dock-hex').click();
  await page.getByTestId('rail-identify').click();
  await expect(page.getByTestId('identify-list')).toBeVisible();
  await expect(page.getByTestId('identify-list').locator('li').first()).toBeVisible();
});

async function gravity(page: Page, x: number, y: number, z: number, n = 40) {
  await page.evaluate(
    ([x, y, z, n]) => {
      for (let i = 0; i < n; i++)
        window.dispatchEvent(
          new DeviceMotionEvent('devicemotion', {
            accelerationIncludingGravity: { x: x * 9.81, y: y * 9.81, z: z * 9.81 },
            interval: 16,
          }),
        );
    },
    [x, y, z, n] as const,
  );
}

test('level: surface tilt, edge angle, zero, hold and slope target', async ({ page }) => {
  await skipOnboarding(page);
  await page.goto('./#/level');
  await expect(page.getByTestId('level-readout')).toBeVisible();
  const deg = (d: number) => (d * Math.PI) / 180;
  await page.getByRole('radio', { name: /Surface/ }).click().catch(() => {});
  await gravity(page, Math.sin(deg(3)), 0, Math.cos(deg(3)));
  await expect(page.getByTestId('level-readout')).toContainText('3.0°');
  await page.getByTestId('level-zero').click();
  await gravity(page, Math.sin(deg(3)), 0, Math.cos(deg(3)), 10);
  await expect(page.getByTestId('level-readout')).toContainText('0.0°');
  await page.getByTestId('level-zero').click(); // back to ABS
  // Edge mode: phone upright, rotated 2° in the screen plane.
  await page.getByText('Edge / angle').click();
  await gravity(page, Math.sin(deg(2)), Math.cos(deg(2)), 0);
  await expect(page.getByTestId('level-readout')).toContainText('2.0°');
  await page.getByTestId('level-hold').click();
  await gravity(page, Math.sin(deg(8)), Math.cos(deg(8)), 0);
  await expect(page.getByTestId('level-readout')).toContainText('2.0°');
  await page.getByTestId('level-hold').click();
  await page.getByTestId('slope-2%').click();
  await expect(page.getByTestId('level-readout')).toContainText('Target 2%');
});
