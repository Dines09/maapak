// Tick generation (§3.5, §4.5). Every tick is computed independently from the origin: pos = n · step.
// Never accumulate (x += step). Tick lengths are in mm, so they look identical on every phone.

export interface Tick {
  /** Integer index from zero. */
  n: number;
  /** Signed distance from the zero tick, mm. */
  posMm: number;
  lengthMm: number;
  /** Stroke width in device px. */
  widthPx: 1 | 2;
  label?: string;
}

export const METRIC_TICK_MM = { ten: 6, five: 4, one: 2.5, half: 1.6 } as const;
export const INCH_TICK_MM: Record<number, number> = { 1: 6.5, 2: 5, 4: 4, 8: 3, 16: 2.2, 32: 1.6, 64: 1.1 };

const MAX_TICKS = 20000;

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Metric ticks with values in [fromMm, toMm] measured from zero.
 * `sub` adds 0.5 mm ticks (loupe only). Labels every 10 mm ("10, 20…" in mm, "1, 2…" in cm).
 */
export function metricTicks(
  fromMm: number,
  toMm: number,
  opts: { sub?: boolean; labelUnit?: 'mm' | 'cm' } = {},
): Tick[] {
  const perMm = opts.sub ? 2 : 1; // ticks per mm
  const n0 = Math.ceil(fromMm * perMm - 1e-9) + 0; // + 0 turns −0 into 0
  const n1 = Math.floor(toMm * perMm + 1e-9);
  const out: Tick[] = [];
  if (n1 - n0 > MAX_TICKS) return out;
  for (let n = n0; n <= n1; n++) {
    const posMm = n / perMm;
    let tick: Tick;
    if (n % perMm !== 0) {
      tick = { n, posMm, lengthMm: METRIC_TICK_MM.half, widthPx: 1 };
    } else {
      const mm = n / perMm;
      if (mm % 10 === 0) {
        const v = Math.abs(mm);
        tick = {
          n,
          posMm,
          lengthMm: METRIC_TICK_MM.ten,
          widthPx: 2,
          label: opts.labelUnit === 'cm' ? String(v / 10) : String(v),
        };
      } else if (mm % 5 === 0) {
        tick = { n, posMm, lengthMm: METRIC_TICK_MM.five, widthPx: 1 };
      } else {
        tick = { n, posMm, lengthMm: METRIC_TICK_MM.one, widthPx: 1 };
      }
    }
    out.push(tick);
  }
  return out;
}

/** Inch ticks at 1/D in. Hierarchy 1 → 1/2 → 1/4 → 1/8 → 1/16 (→ 1/32, 1/64 in the loupe). */
export function inchTicks(fromMm: number, toMm: number, denominator: 16 | 32 | 64): Tick[] {
  const D = denominator;
  const n0 = Math.ceil((fromMm / 25.4) * D - 1e-9) + 0;
  const n1 = Math.floor((toMm / 25.4) * D + 1e-9);
  const out: Tick[] = [];
  if (n1 - n0 > MAX_TICKS) return out;
  for (let n = n0; n <= n1; n++) {
    const den = D / gcd(n, D);
    const posMm = (n * 25.4) / D;
    out.push({
      n,
      posMm,
      lengthMm: INCH_TICK_MM[den] ?? 1,
      widthPx: den === 1 ? 2 : 1,
      label: den === 1 ? String(Math.abs(n / D)) : undefined,
    });
  }
  return out;
}

/** Snap a value (mm from zero) to the nearest tick step, used by marker snapping. */
export function snapToStep(valueMm: number, stepMm: number): number {
  return Math.round(valueMm / stepMm) * stepMm;
}
