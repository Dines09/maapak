import { describe, expect, it } from 'vitest';
import {
  blur3,
  chamfer,
  distanceTransform,
  edges,
  hintFor,
  laplacianVariance,
  matchFrame,
  sobel,
  toGray,
  transformPts,
} from '../../src/core/vision';
import { drawingSvg, layoutDims, viewSvg, dimText } from '../../src/features/drawing/svg';
import { recordGhost, recordViews } from '../../src/features/drawing/model';
import { similarity, applyH, svgMatrix } from '../../src/features/drawing/annotate';
import { recordsToCsv, valueText } from '../../src/features/export/common';
import { defaultCircleState } from '../../src/tools/circle/CircleTool';
import { defaultBoxState } from '../../src/tools/box/BoxTool';
import { defaultHexState } from '../../src/tools/hex/HexTool';
import type { PartRecord, Measurement } from '../../src/core/types';

/** Synthetic frame: dark background with a bright filled rectangle. */
function frame(w: number, h: number, rx: number, ry: number, rw: number, rh: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = x >= rx && x < rx + rw && y >= ry && y < ry + rh ? 220 : 60;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  return d;
}

function rectGhost(x: number, y: number, w: number, h: number): Float32Array {
  const pts: number[] = [];
  for (let t = 0; t <= w; t += 1) pts.push(x + t, y, x + t, y + h);
  for (let t = 0; t <= h; t += 1) pts.push(x, y + t, x + w, y + t);
  return new Float32Array(pts);
}

describe('vision matcher', () => {
  const W = 160;
  const H = 120;
  const img = frame(W, H, 50, 30, 60, 50);
  it('distance transform is 0 on edges and grows away from them', () => {
    const g = toGray(img, W, H);
    const e = edges(sobel(blur3(g)));
    const dt = distanceTransform(e, W, H);
    expect(dt[(30 + 25) * W + 50]).toBeLessThanOrEqual(1);
    expect(dt[(30 + 25) * W + 80]).toBeGreaterThan(8);
  });
  it('a ghost on the part scores ≥ 85; a shifted ghost scores lower and the search finds the shift', () => {
    const good = matchFrame(img, W, H, rectGhost(50, 30, 60, 50));
    expect(good.score).toBeGreaterThanOrEqual(85);
    const off = matchFrame(img, W, H, rectGhost(42, 30, 60, 50));
    expect(off.score).toBeLessThan(good.score);
    expect(off.best.dx).toBeGreaterThan(0);
    expect(off.best.score).toBeGreaterThan(off.score);
    expect(hintFor(off, W)).toBe('right');
  });
  it('transformPts rotates about the centre', () => {
    const p = transformPts(new Float32Array([10, 0]), 0, 0, 1, 90, 0, 0);
    expect(p[0]).toBeCloseTo(0, 5);
    expect(p[1]).toBeCloseTo(10, 5);
  });
  it('sharpness is higher for a crisp image than a blurred one', () => {
    const g = toGray(img, W, H);
    expect(laplacianVariance(g)).toBeGreaterThan(laplacianVariance(blur3(blur3(g))));
    expect(chamfer(new Float32Array(4), 2, 2, new Float32Array([9, 9]))).toBe(15);
  });
});

function rec(ms: Measurement[]): PartRecord {
  return {
    id: 'r1',
    name: 'Part-01',
    tags: ['a'],
    measurements: ms,
    photos: [],
    drawing: { projection: 'first', views: ['top'] },
    createdAt: 0,
    updatedAt: 0,
  };
}
function m(over: Partial<Measurement>): Measurement {
  return {
    id: 'm',
    tool: 'circle',
    kind: 'diameter',
    label: 'Ø1',
    value: 30,
    uncertainty: 0.2,
    toolState: {},
    calibrationId: 'c',
    createdAt: 0,
    ...over,
  };
}

describe('drawing', () => {
  const circle = { ...defaultCircleState(1), placed: true, r: 15 };
  const box = { ...defaultBoxState(1), placed: true, x1: -20, x2: 20, y1: -10, y2: 10 };
  it('builds views from record measurements with record labels and values', () => {
    const r = rec([
      m({ toolState: circle, label: 'OD3', value: 30.04 }),
      m({ tool: 'box', kind: 'length', label: 'L1', value: 40, toolState: box }),
      m({ tool: 'box', kind: 'width', label: 'W1', value: 20, toolState: box }),
    ]);
    const views = recordViews(r);
    expect(views).toHaveLength(2);
    expect(views[0].view.dims[0]).toMatchObject({ label: 'OD3', value: 30.04 });
    expect(views[1].view.dims.map((d) => d.label)).toEqual(['L1', 'W1']);
    expect(recordGhost(r)?.edgeSamples.length).toBeGreaterThan(50);
  });
  it('renders ISO-style dimensions with Ø and honest decimals', () => {
    const svg = drawingSvg(recordViews(rec([m({ toolState: circle, value: 30.04, uncertainty: 0.2 })])), {
      unit: 'mm',
      den: 16,
    });
    expect(svg).toContain('Ø30.0');
    expect(svg).toContain('<circle');
    expect(svg.match(/class="ah"/g)!.length).toBeGreaterThanOrEqual(2);
    expect(svg).toContain('viewBox');
  });
  it('dimension text: AF suffix, angle, fractional inch', () => {
    expect(
      dimText({ kind: 'acrossFlats', label: '', value: 13, uncertainty: 0.2, type: 'linear' }, 'mm', 16),
    ).toBe('13.0 AF');
    expect(
      dimText({ kind: 'angle', label: '', value: 37.44, uncertainty: 0.4, type: 'angle' }, 'mm', 16),
    ).toBe('37.4°');
    expect(
      dimText(
        { kind: 'length', label: '', value: 25.4 * 1.5, uncertainty: 0.2, type: 'linear' },
        'in-frac',
        16,
      ),
    ).toBe('1 1/2″');
  });
  it('stacks dimensions on the same side so they never overlap', () => {
    const d = {
      kind: 'length' as const,
      label: 'L',
      value: 1,
      uncertainty: 0,
      type: 'linear' as const,
      a: [0, 0] as [number, number],
      b: [10, 0] as [number, number],
      offset: -8,
    };
    const out = layoutDims([d, d, d], 7);
    expect(out.map((x) => x.offset)).toEqual([-8, -15, -22]);
  });
  it('hex drawing has AF and AC', () => {
    const hex = { ...defaultHexState(1), placed: true, af: 13 };
    const vs = viewSvg(
      recordViews(rec([m({ tool: 'hex', kind: 'acrossFlats', label: 'AF1', value: 13, toolState: hex })]))[0]
        .view,
      { unit: 'mm', den: 16 },
    );
    expect(vs.body).toContain('13.0 AF');
    expect(vs.body).toContain('15.0'); // AC = 13 × 2/√3
  });
});

describe('photo transform', () => {
  it('similarity maps mm to photo px and converts to an SVG matrix', () => {
    const M = similarity(10, 90, 100, 50);
    const p = applyH(M, [1, 0]);
    expect(p[0]).toBeCloseTo(100, 9);
    expect(p[1]).toBeCloseTo(60, 9);
    expect(svgMatrix([1, 2, 3, 4, 5, 6, 0, 0, 1])).toBe('matrix(1 4 2 5 3 6)');
  });
});

describe('csv', () => {
  it('one row per measurement, with tolerance and honest decimals', () => {
    const r = rec([
      m({ tolerance: { nominal: 30, lower: 29.8, upper: 30.2, result: 'pass' }, repeats: [30, 30.1] }),
    ]);
    const csv = recordsToCsv([r], 'mm');
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Part-01');
    expect(lines[1]).toContain(',30.0,0.2,mm,');
    expect(lines[1]).toContain('pass');
    expect(valueText(m({ kind: 'angle', value: 12.34, uncertainty: 0.3 }), 'mm')).toEqual({
      v: '12.3',
      u: '0.3',
      unit: '°',
    });
  });
});
