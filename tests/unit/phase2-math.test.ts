import { describe, expect, it } from 'vitest';
import {
  circleFrom3,
  fitCircle,
  fitCircleKasa,
  polygonArea,
  pathLength,
  interiorAngles,
  angleBetween,
  acrossCorners,
  acrossFlatsFromCorners,
  squareDiagonal,
} from '../../src/core/geometry/fit';
import { evaluateTolerance, fromPlusMinus } from '../../src/core/tolerance';
import { angleUncertaintyDeg, pointUncertainty, repeatStats } from '../../src/core/uncertainty';
import { suggestWrenches, metricOrInch, METRIC_ROWS, INCH_ROWS } from '../../src/core/standards/hex';
import type { Vec } from '../../src/core/types';

/** Deterministic pseudo-random noise. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
}

describe('circle fits', () => {
  it('3-point circle (Appendix A)', () => {
    const c = circleFrom3([10, 0], [0, 10], [-10, 0])!;
    expect(c.c[0]).toBeCloseTo(0, 12);
    expect(c.c[1]).toBeCloseTo(0, 12);
    expect(c.r).toBeCloseTo(10, 12);
    const off = circleFrom3([35, 20], [20, 35], [5, 20])!;
    expect(off.c).toEqual([20, 20]);
    expect(off.r).toBeCloseTo(15, 12);
    expect(circleFrom3([0, 0], [1, 1], [2, 2])).toBeNull();
  });
  it('least-squares circle recovers centre and radius from noisy points', () => {
    const r = rng(42);
    const pts: Vec[] = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      pts.push([30 + 12.5 * Math.cos(a) + r() * 0.05, 40 + 12.5 * Math.sin(a) + r() * 0.05]);
    }
    const k = fitCircleKasa(pts)!;
    expect(k.r).toBeCloseTo(12.5, 1);
    const f = fitCircle(pts)!;
    expect(f.c[0]).toBeCloseTo(30, 1);
    expect(f.c[1]).toBeCloseTo(40, 1);
    expect(Math.abs(f.r - 12.5)).toBeLessThan(0.02);
    expect(f.rms).toBeLessThan(0.05);
    expect(f.ovality).toBeLessThan(0.3); // noise ±0.05 per axis
  });
  it('geometric fit is exact on a partial arc and reports ovality of an ellipse', () => {
    const arc: Vec[] = [0, 20, 40, 60, 80].map((d) => {
      const a = (d * Math.PI) / 180;
      return [50 * Math.cos(a), 50 * Math.sin(a)];
    });
    expect(fitCircle(arc)!.r).toBeCloseTo(50, 9);
    const ell: Vec[] = Array.from({ length: 36 }, (_, i) => {
      const a = (i / 36) * Math.PI * 2;
      return [11 * Math.cos(a), 10 * Math.sin(a)];
    });
    expect(fitCircle(ell)!.ovality).toBeCloseTo(2, 1);
  });
});

describe('polygon', () => {
  const square: Vec[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  it('shoelace area and perimeter', () => {
    expect(polygonArea(square)).toBe(100);
    expect(polygonArea([...square].reverse())).toBe(100);
    expect(pathLength(square, true)).toBe(40);
    expect(pathLength(square, false)).toBe(30);
  });
  it('interior angles incl. a concave vertex', () => {
    expect(interiorAngles(square).map(Math.round)).toEqual([90, 90, 90, 90]);
    expect(interiorAngles([...square].reverse()).map(Math.round)).toEqual([90, 90, 90, 90]);
    const L: Vec[] = [
      [0, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 20],
      [0, 20],
    ];
    const a = interiorAngles(L).map(Math.round);
    expect(a.filter((x) => x === 270)).toHaveLength(1);
    expect(a.reduce((s, x) => s + x, 0)).toBe(720);
  });
  it('angle between lines', () => {
    expect(angleBetween([1, 0], [0, 1])).toBeCloseTo(90, 12);
    expect(angleBetween([1, 0], [-1, 1])).toBeCloseTo(135, 12);
  });
});

describe('hexagon', () => {
  it('AF ↔ AC and square diagonal', () => {
    expect(acrossCorners(13)).toBeCloseTo(15.011, 3);
    expect(acrossFlatsFromCorners(acrossCorners(13))).toBeCloseTo(13, 12);
    expect(squareDiagonal(10)).toBeCloseTo(14.142, 3);
  });
});

describe('standards: spanner matcher', () => {
  it('every row carries a source', () => {
    for (const r of [...METRIC_ROWS, ...INCH_ROWS]) {
      expect(r.source).toBeTruthy();
      expect(typeof r.verified).toBe('boolean');
    }
  });
  it('13.1 mm → 13 mm (M8) first', () => {
    const s = suggestWrenches(13.1, 0.3);
    const m = s.filter((c) => c.system === 'metric');
    expect(m[0].label).toBe('13 mm');
    expect(m[0].fits).toContain('M8');
    expect(m[0].confidence).toBe('match');
  });
  it('M10 has ISO 16 and DIN 17 rows', () => {
    const m = suggestWrenches(16.9, 0.3).filter((c) => c.system === 'metric');
    expect(m[0].label).toBe('17 mm');
    expect(m[0].fits).toEqual(['M10 (DIN)']);
  });
  it('detects inch spanners', () => {
    expect(metricOrInch(12.7, 0.1)).toBe('inch'); // 1/2″ vs 13 mm
    // 3/4″ (19.05) and 19 mm (DIN M12) are 0.05 mm apart: honestly ambiguous.
    expect(metricOrInch(19.05, 0.2)).toBe('unclear');
    const i = suggestWrenches(19.05, 0.2).find((c) => c.system === 'inch')!;
    expect(i.label).toBe('3/4″');
    expect(metricOrInch(10.0, 0.2)).toBe('metric');
  });
});

describe('tolerance go / no-go', () => {
  const tol = fromPlusMinus(20, 0.2, 0.1); // 19.9 – 20.2
  it('green inside by more than U, amber within U of a limit, red outside', () => {
    expect(evaluateTolerance(20.05, 0.05, tol)).toBe('pass');
    expect(evaluateTolerance(20.18, 0.05, tol)).toBe('warn');
    expect(evaluateTolerance(20.22, 0.05, tol)).toBe('warn');
    expect(evaluateTolerance(20.4, 0.05, tol)).toBe('fail');
    expect(evaluateTolerance(19.7, 0.05, tol)).toBe('fail');
  });
});

describe('repeat & average', () => {
  it('reduces the random part with √n but keeps the calibration part', () => {
    const one = repeatStats([42.3], 0.4, 0.001)!;
    expect(one.U).toBe(0.4);
    const five = repeatStats([42.3, 42.32, 42.28, 42.31, 42.29], 0.4, 0.001)!;
    expect(five.mean).toBeCloseTo(42.3, 9);
    expect(five.spread).toBeCloseTo(0.04, 9);
    expect(five.U).toBeLessThan(one.U);
    expect(five.U).toBeGreaterThanOrEqual(2 * 42.3 * 0.001);
  });
  it('uses the observed scatter when it is larger', () => {
    const r = repeatStats([40, 41, 42], 0.2, 0)!;
    expect(r.s).toBeCloseTo(1, 9);
    expect(r.U).toBeGreaterThanOrEqual((2 * 1) / Math.sqrt(3));
  });
  it('is null without samples', () => {
    expect(repeatStats([], 0.2, 0)).toBeNull();
  });
});

describe('angle uncertainty', () => {
  it('shrinks with longer arms', () => {
    const u = pointUncertainty(16, 'none');
    expect(u).toBeGreaterThan(0);
    expect(angleUncertaintyDeg(u, [80, 80])).toBeLessThan(angleUncertaintyDeg(u, [20, 20]));
    expect(angleUncertaintyDeg(u, [40, 40])).toBeLessThan(1);
  });
});

import { clipPolygonToRect } from '../../src/core/geometry/fit';
describe('polygon clipping', () => {
  it('clips a long strip to the screen rectangle', () => {
    const strip: Vec[] = [
      [10, -1000],
      [30, -1000],
      [30, 1000],
      [10, 1000],
    ];
    const c = clipPolygonToRect(strip, { x: 0, y: 0, w: 60, h: 100 });
    expect(polygonArea(c)).toBeCloseTo(20 * 100, 6);
    expect(clipPolygonToRect(strip, { x: 40, y: 0, w: 10, h: 10 })).toHaveLength(0);
  });
});
