import { describe, expect, it } from 'vitest';
import {
  roundUpOneSig,
  decimalsFor,
  lengthUncertainty,
  relCalUncertainty,
  parallaxMm,
  combineRss,
} from '../../src/core/uncertainty';

describe('uncertainty', () => {
  it('rounds up to one significant figure', () => {
    expect(roundUpOneSig(0.2)).toBe(0.2);
    expect(roundUpOneSig(0.23)).toBe(0.3);
    expect(roundUpOneSig(0.06)).toBe(0.06);
    expect(roundUpOneSig(0.061)).toBe(0.07);
    expect(roundUpOneSig(1.2)).toBe(2);
    expect(roundUpOneSig(0.95)).toBe(1);
    expect(roundUpOneSig(0)).toBe(0);
  });
  it('derives decimals from U (§7.6)', () => {
    expect(decimalsFor(0.2, 'mm')).toBe(1);
    expect(decimalsFor(0.06, 'mm')).toBe(2);
    expect(decimalsFor(2, 'mm')).toBe(0);
    expect(decimalsFor(0.3, 'cm')).toBe(2); // 0.03 cm
    expect(decimalsFor(0.3, 'in')).toBe(2); // 0.0118 in
  });
  it('combines the four terms in quadrature', () => {
    const r = lengthUncertainty({ lengthMm: 100, pxPerMm: 16, relCal: 0.001, screenProtector: 'none' });
    const expected = Math.sqrt(r.uRes ** 2 + r.uAlign ** 2 + r.uCal ** 2 + r.uParallax ** 2);
    expect(r.u).toBeCloseTo(expected, 12);
    expect(r.uRes).toBeCloseTo((0.5 * Math.SQRT2) / 16, 12);
    expect(r.uAlign).toBeCloseTo(Math.SQRT2 / 16, 12);
    expect(r.uCal).toBeCloseTo(0.1, 12);
    expect(r.U).toBeGreaterThanOrEqual(2 * r.u);
    expect(r.U).toBe(roundUpOneSig(2 * r.u));
  });
  it('is larger without the loupe and with tempered glass', () => {
    const base = { lengthMm: 50, pxPerMm: 16, relCal: 0.001 } as const;
    const a = lengthUncertainty({ ...base, screenProtector: 'none' });
    const b = lengthUncertainty({ ...base, screenProtector: 'none', withLoupe: false });
    expect(b.u).toBeGreaterThan(a.u);
    expect(parallaxMm('tempered')).toBeGreaterThan(parallaxMm('film'));
    expect(parallaxMm('film')).toBeGreaterThan(parallaxMm('none'));
  });
  it('computes r_cal from the baseline', () => {
    expect(relCalUncertainty(1, 85.6, 16)).toBeCloseTo(Math.SQRT2 / (85.6 * 16), 12);
  });
  it('grows as √N for chained segments', () => {
    expect(combineRss([0.2, 0.2, 0.2, 0.2])).toBe(0.4);
  });
});
