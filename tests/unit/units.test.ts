import { describe, expect, it } from 'vitest';
import {
  MM_PER_INCH,
  fromMm,
  toMm,
  toFraction,
  formatFraction,
  formatNumber,
  formatLength,
  areaFromMm2,
} from '../../src/core/units';

describe('units', () => {
  it('uses exactly 25.4 mm per inch', () => {
    expect(MM_PER_INCH).toBe(25.4);
    expect(fromMm(25.4, 'in')).toBe(1);
    expect(toMm(1, 'in')).toBe(25.4);
  });
  it('round-trips every unit', () => {
    for (const u of ['mm', 'cm', 'in', 'in-frac'] as const) {
      for (const v of [0, 0.1, 1, 42.3, 1000.05]) expect(toMm(fromMm(v, u), u)).toBeCloseTo(v, 12);
    }
  });
  it('converts cm and areas', () => {
    expect(fromMm(42.3, 'cm')).toBeCloseTo(4.23, 12);
    expect(areaFromMm2(100, 'cm')).toBeCloseTo(1, 12);
    expect(areaFromMm2(645.16, 'in')).toBeCloseTo(1, 12);
  });
  it('makes reduced fractions with error', () => {
    const f = toFraction(42.3, 64); // 1.66535 in → 107/64 = 1 43/64
    expect([f.whole, f.num, f.den]).toEqual([1, 43, 64]);
    expect(formatFraction(f)).toBe('1 43/64″');
    expect(f.errorMm).toBeCloseTo(Math.abs(42.3 / 25.4 - 107 / 64) * 25.4, 12);
    expect(formatFraction(toFraction(25.4 * 0.375, 16))).toBe('3/8″');
    expect(formatFraction(toFraction(50.8, 32))).toBe('2″');
    expect(formatFraction(toFraction(0, 16))).toBe('0″');
    expect(formatFraction(toFraction(-12.7, 16))).toBe('−1/2″');
  });
  it('formats numbers without negative zero', () => {
    expect(formatNumber(-0.01, 1)).toBe('0.0');
    expect(formatNumber(-1.25, 2)).toBe('−1.25');
    expect(formatLength(42.34, 'mm', 1)).toBe('42.3 mm');
    expect(formatLength(42.34, 'cm', 2)).toBe('4.23 cm');
  });
});
