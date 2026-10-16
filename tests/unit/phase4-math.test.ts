import { describe, expect, it } from 'vitest';
import {
  matchPitch,
  nominalFromDiameter,
  identifyBolt,
  pitchFromCrests,
  tpiFromPitch,
  METRIC_THREADS,
  UNIFIED_THREADS,
} from '../../src/core/standards/threads';
import {
  awgDiameter,
  awgFromDiameter,
  matchOringCs,
  nearestSwg,
  nearestCable,
  nearestDrills,
  wireArea,
} from '../../src/core/standards/misc';
import { identify } from '../../src/core/standards/identify';
import {
  complementary,
  edgeAngle,
  fromNearestAxis,
  median,
  reversalOffset,
  slopeMmPerM,
  slopePct,
  slopeRatio,
  surfaceTilt,
} from '../../src/core/level';
import { fitCircle } from '../../src/core/geometry/fit';
import { parseDxf, recordDxf } from '../../src/features/export/dxf';
import type { Vec } from '../../src/core/types';

describe('thread matchers', () => {
  it('every row carries a source', () => {
    for (const r of [...METRIC_THREADS, ...UNIFIED_THREADS] as { source?: string }[])
      expect(r.source).toBeTruthy();
  });
  it('crest count: P = span / N, TPI = 25.4 / P', () => {
    expect(pitchFromCrests(12.5, 10)).toBe(1.25);
    expect(tpiFromPitch(25.4 / 20)).toBeCloseTo(20, 12);
  });
  it('metric vs inch detector', () => {
    expect(matchPitch(1.25, 0.03).verdict).toBe('metric');
    expect(matchPitch(1.25, 0.03).metric[0].sizes).toContain('M8');
    expect(matchPitch(25.4 / 13, 0.03).verdict).toBe('inch'); // 1/2-13 UNC
    expect(matchPitch(25.4 / 13, 0.03).inch[0].label).toBe('13 TPI');
  });
  it('nominal from a measured bolt diameter (slightly under nominal)', () => {
    const n = nominalFromDiameter(7.86, 0.1);
    expect(n[0].size).toBe('M8');
    expect(n[0].plausible).toBe(true);
  });
  it('bolt result card text', () => {
    const b = identifyBolt({ dMm: 7.88, dU: 0.1, pMm: 1.26, pU: 0.03, lengthMm: 39.8 })!;
    expect(b.text).toBe('M8 × 1.25 × 40');
    expect(b.system).toBe('metric');
    expect(b.confidence).toBeGreaterThan(0.8);
    const inch = identifyBolt({ dMm: 12.6, dU: 0.1, pMm: 25.4 / 13, pU: 0.03 })!;
    expect(inch.text).toBe('1/2″-13');
    expect(inch.system).toBe('inch');
    // 5/16″ (7.94 mm) and M8 are close on diameter alone; the pitch decides.
    expect(identifyBolt({ dMm: 7.82, dU: 0.1, pMm: 25.4 / 18, pU: 0.03 })!.text).toBe('5/16″-18');
  });
});

describe('o-ring, wire, drill', () => {
  it('O-ring cross-section series', () => {
    const [as, met] = matchOringCs(2.6);
    expect(as.label).toContain('-1xx');
    expect(met.csMm).toBe(2.5);
  });
  it('AWG formula round-trips; 12 AWG ≈ 2.053 mm', () => {
    expect(awgDiameter(12)).toBeCloseTo(2.053, 2);
    expect(awgFromDiameter(awgDiameter(17))).toBeCloseTo(17, 9);
    expect(nearestSwg(2.0).swg).toBe(14);
    expect(nearestCable(wireArea(1.78)).mm2).toBe(2.5);
  });
  it('drills: 0.1 mm metric and 1/64″ fractional', () => {
    const [m, f] = nearestDrills(6.36);
    expect(m.label).toBe('6.4 mm');
    expect(f.label).toBe('1/4″');
  });
  it('part identifier ranks matches', () => {
    const r = identify([{ kind: 'acrossFlats', value: 13.05, uncertainty: 0.2 }]);
    expect(r[0].title).toContain('13 mm');
    expect(identify([{ kind: 'pitch', value: 1.5, uncertainty: 0.03 }])[0].title).toBe('P 1.5 mm');
  });
});

describe('level math', () => {
  it('slope conversions', () => {
    expect(slopePct(45)).toBeCloseTo(100, 9);
    expect(slopeMmPerM(1)).toBeCloseTo(17.455, 3);
    expect(slopeRatio(Math.atan(1 / 50) * (180 / Math.PI))).toBeCloseTo(50, 9);
    expect(slopeRatio(0)).toBe(Infinity);
  });
  it('tilt from gravity, nearest axis, reversal offset', () => {
    const [x, y] = surfaceTilt([0, 0, 9.81]);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(0, 12);
    expect(surfaceTilt([9.81 * Math.sin(0.1), 0, 9.81 * Math.cos(0.1)])[0]).toBeCloseTo(
      (0.1 * 180) / Math.PI,
      9,
    );
    expect(edgeAngle([0, 9.81, 0])).toBeCloseTo(0, 12);
    expect(fromNearestAxis(91.2)).toEqual({ deviation: expect.closeTo(1.2, 9), axis: 90 });
    // Reading +0.4 then (rotated 180°) −0.2 → sensor offset 0.1°
    expect(reversalOffset(0.4, -0.2)).toBeCloseTo(0.1, 12);
  });
  it('median and complementary filter', () => {
    expect(median([3, 1, 2, 10, 4])).toBe(3);
    expect(complementary(0, 10, 0.1, 1)).toBeCloseTo(0.98 * 1 + 0.02 * 1, 12);
  });
});

describe('arc fit (bigger than the screen)', () => {
  it('uncertainty grows as the visible arc shrinks', () => {
    const arc = (spanDeg: number): Vec[] =>
      Array.from({ length: 9 }, (_, i) => {
        const a = ((-spanDeg / 2 + (i * spanDeg) / 8) * Math.PI) / 180;
        // deterministic ±0.05 mm noise
        const n = (i % 3) - 1;
        return [(150 + n * 0.05) * Math.cos(a), (150 + n * 0.05) * Math.sin(a)];
      });
    const wide = fitCircle(arc(120), 30, 0.08)!;
    const narrow = fitCircle(arc(25), 30, 0.08)!;
    expect(wide.r).toBeCloseTo(150, 0);
    expect(narrow.uR).toBeGreaterThan(wide.uR * 5);
  });
});

describe('DXF', () => {
  it('writes R12 entities that parse', () => {
    const views = [
      {
        title: 'x',
        view: {
          outline: [
            { type: 'circle' as const, center: [0, 0] as Vec, r: 10 },
            {
              type: 'polyline' as const,
              points: [
                [-5, -5],
                [5, -5],
                [5, 5],
              ] as Vec[],
              closed: true,
            },
          ],
          dims: [
            {
              kind: 'diameter' as const,
              label: 'Ø1',
              value: 20,
              uncertainty: 0.2,
              type: 'diameter' as const,
              center: [0, 0] as Vec,
              r: 10,
            },
          ],
        },
      },
    ];
    const txt = recordDxf(views, 'mm', 16);
    const p = parseDxf(txt);
    expect(p.entities.CIRCLE).toBe(1);
    expect(p.entities.LINE).toBeGreaterThanOrEqual(4);
    expect(p.entities.TEXT).toBe(1);
    expect(txt).toContain('%%c20.0');
    expect(txt.trim().endsWith('EOF')).toBe(true);
  });
});
