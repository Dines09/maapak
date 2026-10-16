import { describe, expect, it } from 'vitest';
import { metricTicks, inchTicks, METRIC_TICK_MM } from '../../src/render/ticks';

describe('tick generation', () => {
  it('has the metric hierarchy and labels', () => {
    const t = metricTicks(0, 20);
    expect(t).toHaveLength(21);
    expect(t[0]).toMatchObject({ posMm: 0, lengthMm: METRIC_TICK_MM.ten, label: '0', widthPx: 2 });
    expect(t[5].lengthMm).toBe(METRIC_TICK_MM.five);
    expect(t[3].lengthMm).toBe(METRIC_TICK_MM.one);
    expect(t[10].label).toBe('10');
    expect(metricTicks(0, 20, { labelUnit: 'cm' })[20].label).toBe('2');
  });
  it('adds 0.5 mm sub-ticks only on request', () => {
    const t = metricTicks(0, 2, { sub: true });
    expect(t.map((x) => x.posMm)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(t[1].lengthMm).toBe(METRIC_TICK_MM.half);
  });
  it('labels the negative side with absolute values', () => {
    const t = metricTicks(-10, 0);
    expect(t[0]).toMatchObject({ posMm: -10, label: '10' });
  });
  it('has the inch hierarchy', () => {
    const t = inchTicks(0, 25.4, 16);
    expect(t).toHaveLength(17);
    expect(t[16]).toMatchObject({ label: '1', widthPx: 2 });
    expect(t[8].lengthMm).toBeGreaterThan(t[4].lengthMm);
    expect(t[4].lengthMm).toBeGreaterThan(t[2].lengthMm);
    expect(t[2].lengthMm).toBeGreaterThan(t[1].lengthMm);
    expect(inchTicks(0, 25.4, 64)[1].lengthMm).toBeLessThan(t[1].lengthMm);
  });
  it('does not drift over 10,000 ticks (no cumulative error)', () => {
    const t = metricTicks(0, 10000);
    expect(t).toHaveLength(10001);
    for (const k of t) expect(k.posMm).toBe(k.n);
    const inch = inchTicks(0, 10000 * (25.4 / 64), 64);
    expect(inch).toHaveLength(10001);
    for (const k of inch) expect(k.posMm).toBe((k.n * 25.4) / 64);
  });
});
