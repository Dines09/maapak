import { describe, expect, it } from 'vitest';
import { makeTransform } from '../../src/core/calibration';
import { lengthUncertainty } from '../../src/core/uncertainty';
import type { ToolEnv, ToolInstance } from '../../src/render/types';
import type { PartRecord, Vec } from '../../src/core/types';
import { pcdFit } from '../../src/core/geometry/pcd';
import { LevelFilter, edgeAngle, surfaceTilt, upFromOrientation } from '../../src/core/level';
import { parseSlope } from '../../src/features/level/LevelScreen';
import { RadiusTool, defaultRadiusState } from '../../src/tools/radius/RadiusTool';
import { GridTool, defaultGridState } from '../../src/tools/grid/GridTool';
import { DatumTool, defaultDatumState } from '../../src/tools/datum/DatumTool';
import { GasketTool, defaultGasketState } from '../../src/tools/gasket/GasketTool';
import { TemplateTool, defaultTemplateState } from '../../src/tools/template/TemplateTool';
import { RulerTool, defaultRulerState } from '../../src/tools/ruler/RulerTool';
import { TOOL_REGISTRY, createTool } from '../../src/tools/registry';
import { boltSummary, boltTitle, boltViews } from '../../src/features/bolt/bolt';
import { recordViews } from '../../src/features/drawing/model';
import { parseDxf, recordDxf } from '../../src/features/export/dxf';
import { blankRecord } from '../../src/features/records/repo';

const bounds = { x: 0, y: 0, w: 66, h: 140 };
function env(): ToolEnv {
  const t = makeTransform({ pxPerMmX: 16, pxPerMmY: 16 }, 0, 2.625);
  return {
    transform: () => t,
    bounds: () => bounds,
    placeBounds: () => bounds,
    uncertainty: (L, dir, edges) =>
      lengthUncertainty({ lengthMm: L, pxPerMm: t.pxPerMmAlong(dir), relCal: 0.001, screenProtector: 'none', edges }).U,
    pointU: () => 0.08,
    relCal: () => 0.001,
    tickSnapMm: () => 0,
    snapPoints: () => [],
    otherAngles: () => [],
    angleSnap: () => false,
    haptic: () => {},
    unit: () => 'mm',
    fractionDen: () => 16,
  };
}
function attach<T extends ToolInstance>(t: T): T {
  t.attach(env());
  return t;
}
function drag(t: ToolInstance, id: string, from: Vec, to: Vec): void {
  const h = { id, kind: 'point' as const, posMm: from };
  t.onDragStart(h, from);
  t.onDragMove(h, to, false);
  t.onDragEnd(h);
}

describe('PCD finder', () => {
  const ring = (n: number, r: number, c: Vec, jitter: number[] = []): Vec[] =>
    Array.from({ length: n }, (_, i) => {
      const a = ((i * 360) / n + 17 + (jitter[i] ?? 0)) * (Math.PI / 180);
      return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as Vec;
    });
  it('fits PCD, N and pitch exactly for an even pattern', () => {
    const f = pcdFit(ring(6, 40, [10, -5]))!;
    expect(f.pcd).toBeCloseTo(80, 9);
    expect(f.n).toBe(6);
    expect(f.pitchDeg).toBe(60);
    expect(f.maxAngDev).toBeLessThan(1e-9);
  });
  it('reports the angular deviation of a misplaced hole', () => {
    const f = pcdFit(ring(4, 30, [0, 0], [0, 0, 2, 0]))!;
    // Best-fit rotation spreads the 2° error: the odd hole ≈ +1.5°, the others ≈ −0.5°.
    expect(f.angDev[2]).toBeCloseTo(1.5, 3);
    expect(f.maxAngDev).toBeCloseTo(1.5, 3);
  });
  it('needs three holes', () => {
    expect(pcdFit([[0, 0], [1, 1]])).toBeNull();
  });
});

describe('level filter and sensors', () => {
  it('orientation β/γ gives the expected up vector', () => {
    const flat = upFromOrientation(0, 0);
    expect(flat[2]).toBeCloseTo(1, 9);
    const upright = upFromOrientation(90, 0);
    expect(upright[1]).toBeCloseTo(1, 9);
    expect(edgeAngle(upright)).toBeCloseTo(0, 9);
    const [roll, pitch] = surfaceTilt(upFromOrientation(3, 0));
    expect(roll).toBeCloseTo(0, 6);
    expect(pitch).toBeCloseTo(3, 6);
  });
  it('converges to the accelerometer angle and smooths noise', () => {
    const f = new LevelFilter();
    let v = 0;
    for (let i = 0; i < 200; i++) v = f.push(2 + (i % 2 ? 0.3 : -0.3), null, 0.016);
    expect(Math.abs(v - 2)).toBeLessThan(0.31);
  });
  it('is wrap-safe around ±180°', () => {
    const f = new LevelFilter();
    let v = 0;
    for (let i = 0; i < 100; i++) v = f.push(i % 2 ? 179.8 : -179.8, null, 0.016);
    expect(Math.abs(Math.abs(v) - 180)).toBeLessThan(0.3);
  });
  it('learns the gyro sign and follows a rotation', () => {
    for (const s of [1, -1]) {
      const f = new LevelFilter();
      let a = 0;
      let v = 0;
      for (let i = 0; i < 300; i++) {
        a += 30 * 0.016; // 30°/s
        v = f.push(a, s * 30, 0.016);
      }
      expect(Math.abs(v - (((a + 180) % 360) - 180))).toBeLessThan(1);
    }
  });
  it('parses slope presets', () => {
    expect(parseSlope('2%')!).toBeCloseTo(1.1458, 3);
    expect(parseSlope('1:12')!).toBeCloseTo(4.7636, 3);
    expect(parseSlope('5°')).toBe(5);
    expect(parseSlope('3,5')).toBe(3.5);
    expect(parseSlope('abc')).toBeNull();
  });
});

describe('Phase 4 tools', () => {
  it('registry has every specialty tool and they round-trip', () => {
    for (const id of ['threadGauge', 'wireGauge', 'radiusGauge', 'grid', 'datumXY', 'gasket', 'template'] as const) {
      const def = TOOL_REGISTRY[id];
      expect(def, id).toBeTruthy();
      const t = attach(createTool(id, [])!);
      expect(t.readouts().length).toBeGreaterThan(0);
      const back = def!.deserialize(JSON.parse(JSON.stringify(t.serialize())));
      expect(back.tool).toBe(id);
    }
  });
  it('radius gauge: template value and 3-point arc fit', () => {
    const t = attach(new RadiusTool(defaultRadiusState()));
    t.setExactValue?.('r', 6);
    expect(t.readouts()[0].value).toBe(6);
    t.s.mode = 'points';
    t.s.pts = [
      [10, 0],
      [0, 10],
      [-10, 0],
    ];
    const r = t.readouts()[0];
    expect(r.value).toBeCloseTo(10, 9);
    expect(r.notes?.[0]).toBe('arc 180°');
    // A short arc gives a larger uncertainty than a half circle.
    const U180 = r.uncertainty;
    const a = (d: number): Vec => [10 * Math.cos((d * Math.PI) / 180), 10 * Math.sin((d * Math.PI) / 180)];
    t.s.pts = [a(0), a(15), a(30)];
    expect(t.readouts()[0].value).toBeCloseTo(10, 9);
    expect(t.readouts()[0].uncertainty).toBeGreaterThan(U180);
  });
  it('grid presets include inch spacings and dragging moves the origin', () => {
    const g = attach(new GridTool(defaultGridState()));
    expect(g.presets().map((p) => p.label)).toEqual(['1 mm', '5 mm', '10 mm', '1/8″', '1/4″']);
    g.presets()[3].run();
    expect(g.readouts()[0].value).toBeCloseTo(3.175, 9);
    const o = g.s.origin;
    drag(g, 'ind:o', [20, 20], [25, 30]);
    expect(g.s.origin).toEqual([o[0] + 5, o[1] + 10]);
  });
  it('datum XY: coordinates in the rotated datum frame (+Y up)', () => {
    const d = attach(new DatumTool(defaultDatumState()));
    d.s.origin = [10, 100];
    d.s.angle = 0;
    d.s.pts = [[30, 90]];
    const [x, y] = d.readouts();
    expect(x.value).toBeCloseTo(20, 9);
    expect(y.value).toBeCloseTo(10, 9);
    d.s.angle = -90; // X axis pointing up the screen
    expect(d.readouts()[0].value).toBeCloseTo(10, 9);
    expect(d.readouts()[1].value).toBeCloseTo(-20, 9);
    d.actions()[0].run();
    expect(d.s.pts.length).toBe(2);
  });
  it('gasket builder: OD / ID / PCD / N, presets and drawing', () => {
    const g = attach(new GasketTool(defaultGasketState()));
    g.s.R = 30;
    g.s.ri = 10;
    g.s.pcdR = 22;
    g.presets().find((p) => p.label === '6×')!.run();
    const rs = Object.fromEntries(g.readouts().map((r) => [r.label, r.value]));
    expect(rs.OD1).toBe(60);
    expect(rs.ID1).toBe(20);
    expect(rs.PCD1).toBe(44);
    expect(rs.N).toBe(6);
    expect(rs['∠']).toBe(60);
    const top = g.toDrawing().views.top!;
    expect(top.outline.filter((e) => e.type === 'circle').length).toBe(1 + 1 + 6 + 1);
    expect(top.dims.map((d) => d.kind)).toContain('pcd');
    expect(g.toMeasurements().map((m) => m.kind)).toContain('pcd');
  });
  it('gasket PCD finder: free holes → fitted PCD with uniformity notes', () => {
    const g = attach(new GasketTool(defaultGasketState(1, 'pcd')));
    g.s.holes = [0, 90, 180, 270].map((a) => ({
      c: [50 + 25 * Math.cos((a * Math.PI) / 180), 60 + 25 * Math.sin((a * Math.PI) / 180)] as Vec,
      r: 4,
    }));
    const [pcd] = g.readouts();
    expect(pcd.kind).toBe('pcd');
    expect(pcd.value).toBeCloseTo(50, 9);
    expect(pcd.notes?.[0]).toContain('N = 4');
    g.actions().find((a) => a.id === 'add')!.run();
    expect(g.s.holes.length).toBe(5);
    const nh = g.s.holes[4].c;
    expect(Math.hypot(nh[0] - 50, nh[1] - 60)).toBeCloseTo(25, 6);
  });
  it('template: record outline at 1:1, moves and keeps its size', () => {
    const t = attach(
      new TemplateTool(defaultTemplateState([{ type: 'circle', center: [0, 0], r: 10 }], 'Ring-01')),
    );
    const pts = t.outline!();
    const c = t.s.c;
    expect(Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])))).toBeCloseTo(10, 6);
    drag(t, 'ind:c', [0, 0], [3, 4]);
    expect(t.s.c).toEqual([c[0] + 3, c[1] + 4]);
    t.presets().find((p) => p.label === '±0.2')!.run();
    expect(t.readouts()[0].value).toBe(0.2);
    expect(t.toMeasurements()).toEqual([]);
  });
  it('thread gauge (crest count) gives pitch and a metric verdict', () => {
    const r = attach(new RulerTool(defaultRulerState('threadGauge', 1, 0)));
    const rs = r.readouts();
    expect(rs.find((x) => x.kind === 'pitch')).toBeTruthy();
  });
  it('wire gauge gives AWG / mm² notes', () => {
    const r = attach(new RulerTool(defaultRulerState('wireGauge', 1, 0)));
    const d = r.readouts()[0];
    expect(d.notes?.some((n) => n.startsWith('AWG'))).toBe(true);
  });
});

describe('Bolt Wizard', () => {
  const ms = (list: [string, string, number][]): PartRecord['measurements'] =>
    list.map(([label, kind, value], i) => ({
      id: `m${i}`,
      tool: 'ruler',
      kind: kind as never,
      label,
      value,
      uncertainty: kind === 'pitch' ? 0.02 : 0.1,
      toolState: { tool: 'ruler' },
      calibrationId: 'c',
      createdAt: 0,
    }));
  const rec = (): PartRecord => ({
    ...blankRecord('Bolt-01'),
    recipe: 'bolt',
    bolt: { head: 'hex' },
    measurements: ms([
      ['L1', 'length', 40],
      ['Ø1', 'diameter', 7.85],
      ['AF1', 'acrossFlats', 13.02],
      ['k1', 'length', 5.3],
      ['P1', 'pitch', 1.25],
    ]),
  });
  it('identifies M8 × 1.25 × 40 with a 13 AF hex head and a nut', () => {
    const s = boltSummary(rec());
    expect(s.id?.text).toBe('M8 × 1.25 × 40');
    expect(s.id?.system).toBe('metric');
    expect(s.k?.value).toBe(5.3);
    expect(boltTitle(s, 'Hex head bolt')).toBe('M8 × 1.25 × 40 — Hex head bolt, 13 mm AF');
    expect(s.nut).toContain('M8');
  });
  it('builds front + top views and exports them to DXF', () => {
    const r = rec();
    const v = boltViews(r, 'hex');
    expect(v.map((x) => x.title)).toEqual(['front', 'top']);
    expect(v[0].view.dims.map((d) => d.label)).toEqual(['L1', 'Ø1', 'k1']);
    expect(v[1].view.dims.map((d) => d.label)).toEqual(['AF1']);
    expect(recordViews(r)).toHaveLength(2);
    const dxf = parseDxf(recordDxf(recordViews(r), 'mm', 16));
    expect(dxf.entities.LINE).toBeGreaterThan(10);
    expect(dxf.entities.TEXT).toBe(4);
  });
  it('countersunk length is overall and other heads draw', () => {
    for (const h of ['socket', 'countersunk', 'button', 'pan', 'carriage'] as const) {
      const v = boltViews({ ...rec(), bolt: { head: h } }, h);
      expect(v[0].view.outline.length, h).toBeGreaterThan(3);
    }
  });
});
