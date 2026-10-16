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
    type T = { s: Record<string, number>; Q(t: number, o: number): [number, number]; knobOff(): number };
    const st = (
      window as unknown as {
        __maapak: { tools: T[]; getTransform(): { mmToCssPx(p: [number, number]): [number, number] } };
      }
    ).__maapak;
    const tool = st.tools[0];
    const [x, y] = st.getTransform().mmToCssPx(tool.Q(tool.s[id], tool.knobOff()));
    return { x, y };
  }, id);
}

export async function hudValue(page: Page): Promise<string> {
  return (await page.getByTestId('hud-value').innerText()).trim();
}

/** Dispatch synthetic touch pointer events on the stage canvas (multi-touch gestures). */
export async function touch(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  id: number,
  x: number,
  y: number,
) {
  await page.evaluate(
    ([type, id, x, y]) => {
      const c = document.querySelector('[data-testid="stage"]')!;
      c.dispatchEvent(
        new PointerEvent(type as string, {
          pointerId: id as number,
          pointerType: 'touch',
          clientX: x as number,
          clientY: y as number,
          width: 8,
          height: 8,
          bubbles: true,
          cancelable: true,
          isPrimary: id === 1,
        }),
      );
    },
    [type, id, x, y] as const,
  );
}

export async function toolKind(page: Page): Promise<string> {
  return page.evaluate(
    () => (window as unknown as { __maapak: { tools: { tool: string }[] } }).__maapak.tools[0]?.tool,
  );
}
