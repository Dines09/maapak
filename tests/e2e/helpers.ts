import type { Page } from '@playwright/test';

export async function skipOnboarding(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByTestId('welcome-skip').click();
  await page.getByTestId('tour').getByRole('button').first().click(); // skip tour
  await page.waitForFunction(
    () => (window as unknown as { __maapak?: { tools: unknown[] } }).__maapak?.tools.length,
  );
}

/** CSS position of a ruler marker knob ('a' | 'b') on the first tool. */
export async function knobPos(page: Page, id: 'a' | 'b'): Promise<{ x: number; y: number }> {
  return page.evaluate((id) => {
    type T = { s: { [k: string]: number } & { width: number }; Q(t: number, o: number): [number, number] };
    const st = (
      window as unknown as {
        __maapak: { tools: T[]; getTransform(): { mmToCssPx(p: [number, number]): [number, number] } };
      }
    ).__maapak;
    const tool = st.tools[0];
    const [x, y] = st.getTransform().mmToCssPx(tool.Q(tool.s[id], tool.s.width + 6.5));
    return { x, y };
  }, id);
}

export async function hudValue(page: Page): Promise<string> {
  return (await page.getByTestId('hud-value').innerText()).trim();
}
