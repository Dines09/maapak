import { describe, expect, it } from 'vitest';
import { makeTransform } from '../../src/core/calibration';
import { lengthUncertainty } from '../../src/core/uncertainty';
import type { ToolEnv, ToolInstance } from '../../src/render/types';
import type { Vec } from '../../src/core/types';
import {
  CaliperTool,
  defaultCaliperState,
  vernierReading,
  vernierSpec,
} from '../../src/tools/caliper/CaliperTool';
import { ProtractorTool, defaultProtractorState } from '../../src/tools/protractor/ProtractorTool';
import { CircleTool, defaultCircleState } from '../../src/tools/circle/CircleTool';
import { HexTool, defaultHexState } from '../../src/tools/hex/HexTool';
import { RectTool, defaultRectState } from '../../src/tools/rect/RectTool';
import { PolygonTool, defaultPolygonState } from '../../src/tools/polygon/PolygonTool';
import { TOOL_REGISTRY, QUICK_SHAPES, createTool } from '../../src/tools/registry';

const bounds = { x: 0, y: 0, w: 66, h: 140 };
function env(): ToolEnv {
  const t = makeTransform({ pxPerMmX: 16, pxPerMmY: 16 }, 0, 2.625);
  return {
    transform: () => t,
    bounds: () => bounds,
    placeBounds: () => bounds,
    uncertainty: (L, dir, edges) =>
      lengthUncertainty({
        lengthMm: L,
        pxPerMm: t.pxPerMmAlong(dir),
        relCal: 0.001,
        screenProtector: 'none',
        edges,
      }).U,
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
  t.fit?.(bounds);
  return t;
}

function drag(t: ToolInstance, id: string, delta: Vec, from: Vec = [0, 0]): void {
  const h = { id, kind: 'edge' as const, posMm: from };
  t.onDragStart(h, from);
  t.onDragMove(h, [from[0] + delta[0], from[1] + delta[1]], false);
  t.onDragEnd(h);
}

describe('vernier caliper', () => {
  it('vernier specs give the stated least counts', () => {
    for (const lc of [0.1, 0.05, 0.02] as const) {
      const s = vernierSpec(lc);
      // one main division (1 mm, or 2 mm for the 0.05 scale) minus one vernier division = LC
      const main = lc === 0.05 ? 2 : 1;
      expect(main - s.d).toBeCloseTo(lc, 12);
    }
    const inch = vernierSpec('in');
    expect(0.025 - inch.d).toBeCloseTo(0.001, 12);
    expect(inch.N * inch.d).toBeCloseTo(0.6, 12);
  });
  it('reads main scale + coinciding line', () => {
    expect(vernierReading(23.35, 0.05)).toMatchObject({ main: 23, line: 7, reading: 23.35 });
    expect(vernierReading(12.46, 0.02)).toMatchObject({ main: 12, line: 23, reading: 12.46 });
    expect(vernierReading(7.3, 0.1)).toMatchObject({ main: 7, line: 3, reading: 7.3 });
    expect(vernierReading(9.99, 0.1)).toMatchObject({ main: 10, line: 0, reading: 10 });
    const r = vernierReading(25.4 * 0.437, 'in');
    expect(r.unit).toBe('in');
    expect(r.reading).toBeCloseTo(0.437, 9);
  });
  it('jaw drag sets the opening; labels follow the feature', () => {
    const c = attach(new CaliperTool(defaultCaliperState()));
    const s0 = c.s.s;
    expect(c.s.angle).toBe(90); // portrait phone: beam along the long axis
    const u: Vec = [Math.cos((c.s.angle * Math.PI) / 180), Math.sin((c.s.angle * Math.PI) / 180)];
    drag(c, 'jaw', [u[0] * 12.5 + u[1] * 3, u[1] * 12.5 - u[0] * 3]); // perpendicular part ignored
    expect(c.readouts()[0].value).toBeCloseTo(s0 + 12.5, 12);
    expect(c.readouts()[0].kind).toBe('outerDiameter');
    c.actions()
      .find((a) => a.id === 'feature')!
      .run();
    expect(c.readouts()[0].kind).toBe('innerDiameter');
    expect(c.setExactValue('jaw', 30)).toBe(true);
    expect(c.readouts()[0].value).toBe(30);
    c.wheel(0.05);
    expect(c.readouts()[0].value).toBeCloseTo(30.05, 12);
  });
  it('learn mode exposes the vernier reading', () => {
    const c = attach(new CaliperTool({ ...defaultCaliperState(), lc: 0.05 }));
    c.s.s = 18.65;
    c.s.learn = true;
    expect(c.readouts()[0].learn).toMatchObject({ main: 18, line: 13, reading: 18.65 });
  });
});

describe('protractor', () => {
  it('measuring arm angle is counter-clockwise from the baseline', () => {
    const p = attach(new ProtractorTool(defaultProtractorState()));
    p.s.base = 0;
    p.s.phi = 0;
    const V = p.s.vertex;
    const end: Vec = [V[0] + p.s.arm2, V[1]];
    // Move the arm end straight up (screen −y) by the arm length → 45°.
    drag(p, 'arm', [0, -p.s.arm2], end);
    expect(p.readouts()[0].value).toBeCloseTo(45, 9);
    expect(p.readouts()[0].unit).toBe('angle');
    expect(p.readouts()[0].uncertainty).toBeGreaterThan(0);
  });
  it('half mode clamps below the baseline; full mode allows reflex', () => {
    const p = attach(new ProtractorTool(defaultProtractorState()));
    p.s.base = 0;
    p.s.phi = 10;
    const V = p.s.vertex;
    const end: Vec = [
      V[0] + p.s.arm2 * Math.cos(-10 * (Math.PI / 180)),
      V[1] + p.s.arm2 * Math.sin(-10 * (Math.PI / 180)),
    ];
    drag(p, 'arm', [0, p.s.arm2 * 0.5], end); // swing below the baseline
    expect(p.s.phi).toBe(0);
    p.s.mode = 'full';
    drag(p, 'arm', [0, p.s.arm2 * 0.5], [V[0] + p.s.arm2, V[1]]);
    expect(p.s.phi).toBeGreaterThan(180);
  });
  it('snaps to the chosen step', () => {
    const p = attach(new ProtractorTool({ ...defaultProtractorState(), snap: 5 }));
    p.s.base = 0;
    const V = p.s.vertex;
    const a = (33 * Math.PI) / 180;
    drag(
      p,
      'arm',
      [
        p.s.arm2 * Math.cos(a) - p.s.arm2 * Math.cos(Math.PI / 3),
        -p.s.arm2 * Math.sin(a) + p.s.arm2 * Math.sin(Math.PI / 3),
      ],
      [V[0] + p.s.arm2 * Math.cos(Math.PI / 3), V[1] - p.s.arm2 * Math.sin(Math.PI / 3)],
    );
    expect(p.s.phi).toBe(35);
  });
  it('two-line angle works when the lines meet off-screen', () => {
    const p = attach(new ProtractorTool({ ...defaultProtractorState(), mode: 'twoLine' }));
    p.s.pts = [
      [0, 0],
      [10, 0],
      [0, 5],
      [10, 5 - 10 * Math.tan((3 * Math.PI) / 180)],
    ];
    expect(p.lineAngle()).toBeCloseTo(3, 9);
    expect(p.readouts()[1].value).toBeCloseTo(177, 9);
  });
});

describe('circle / ring', () => {
  it('squeeze-to-fit: one side moves, the opposite stays, the circle re-centres', () => {
    const c = attach(new CircleTool(defaultCircleState()));
    c.s.c = [33, 70];
    c.s.r = 25;
    drag(c, 'E', [-10, 0]);
    expect(c.s.r).toBeCloseTo(20, 12);
    expect(c.s.c[0]).toBeCloseTo(28, 12); // W side stayed at 8
    expect(c.s.c[0] - c.s.r).toBeCloseTo(8, 12);
    drag(c, 'N', [0, 6]);
    expect(c.s.r).toBeCloseTo(17, 12);
    expect(c.s.c[1] + c.s.r).toBeCloseTo(90, 12); // S side stayed
    expect(c.readouts()[0]).toMatchObject({ kind: 'diameter' });
    expect(c.readouts()[0].value).toBeCloseTo(34, 12);
  });
  it('ring readouts: OD, ID, CS = (OD − ID)/2', () => {
    const c = attach(new CircleTool(defaultCircleState(1, 'ring')));
    c.s.r = 15;
    c.s.ri = 10;
    const [od, id, cs, mean] = c.readouts();
    expect(od.value).toBe(30);
    expect(id.value).toBe(20);
    expect(cs.value).toBe(5);
    expect(mean.value).toBe(25);
    // concentric inner squeeze sets the inner radius directly
    c.s.ci = [...c.s.c];
    drag(c, 'e', [-2, 0]);
    expect(c.s.ri).toBeCloseTo(8, 12);
  });
  it('3-point and multi-point modes fit the rim points', () => {
    const c = attach(new CircleTool(defaultCircleState(1, 'points')));
    expect(c.s.pts).toHaveLength(3);
    c.s.pts = [
      [30, 50],
      [40, 60],
      [30, 70],
    ];
    drag(c, 'p0', [0, 0]);
    expect(c.s.r).toBeCloseTo(10, 9);
    c.addPoint();
    expect(c.s.pts).toHaveLength(4);
    const labels = c.readouts().map((r) => r.nameKey);
    expect(labels).toContain('readout.ovality');
  });
});

describe('hex overlay', () => {
  it('flat squeeze keeps the opposite flat; AC = AF × 2/√3; spanner notes', () => {
    const h = attach(new HexTool(defaultHexState()));
    h.s.angle = 0;
    h.s.c = [33, 70];
    h.s.af = 20;
    drag(h, 'f0', [-7, 0]); // flat 0 faces +x
    expect(h.s.af).toBeCloseTo(13, 12);
    expect(h.s.c[0] - h.s.af / 2).toBeCloseTo(23, 12);
    const [af, ac] = h.readouts();
    expect(ac.value).toBeCloseTo((13 * 2) / Math.sqrt(3), 12);
    expect(af.notes?.some((n) => n.includes('13 mm') && n.includes('M8'))).toBe(true);
  });
  it('square nut mode: diagonal = AF × √2', () => {
    const h = attach(new HexTool(defaultHexState(1, 'square')));
    h.s.af = 10;
    expect(h.readouts()[1].value).toBeCloseTo(10 * Math.SQRT2, 12);
  });
});

describe('rectangle', () => {
  it('edge drag keeps the opposite edge; area and perimeter with corner radius', () => {
    const r = attach(new RectTool(defaultRectState()));
    r.s.angle = 0;
    r.s.c = [33, 70];
    r.s.w = 40;
    r.s.h = 20;
    drag(r, 'e', [5, 0]);
    expect(r.s.w).toBeCloseTo(45, 12);
    expect(r.s.c[0] - r.s.w / 2).toBeCloseTo(13, 12);
    r.s.r = 2;
    const area = r.readouts().find((x) => x.kind === 'area')!;
    expect(area.value).toBeCloseTo(45 * 20 - (4 - Math.PI) * 4, 9);
    const per = r.readouts().find((x) => x.kind === 'perimeter')!;
    expect(per.value).toBeCloseTo(2 * 65 - 16 + 4 * Math.PI, 9);
  });
  it('square lock keeps sides equal', () => {
    const r = attach(new RectTool(defaultRectState(1, true)));
    drag(r, 'ne', [4, -4]);
    expect(r.s.w).toBeCloseTo(r.s.h, 12);
  });
});

describe('polygon', () => {
  it('shoelace area, perimeter, vertex insertion and open path length', () => {
    const p = attach(new PolygonTool(defaultPolygonState()));
    p.s.pts = [
      [10, 10],
      [40, 10],
      [40, 30],
      [10, 30],
    ];
    expect(p.readouts()[0]).toMatchObject({ kind: 'area', value: 600 });
    p.addVertex();
    expect(p.s.pts).toHaveLength(5);
    expect(p.readouts()[0].value).toBeCloseTo(600, 9);
    p.actions()
      .find((a) => a.id === 'closed')!
      .run();
    expect(p.s.closed).toBe(false);
    expect(p.readouts()[0].kind).toBe('length');
  });
});

describe('registry & quick shapes', () => {
  it('every Phase 2 tool round-trips through serialize/deserialize', () => {
    for (const id of ['caliper', 'protractor', 'circle', 'hex', 'rect', 'polygon'] as const) {
      const t = attach(createTool(id, [])!);
      const copy = TOOL_REGISTRY[id]!.deserialize(JSON.parse(JSON.stringify(t.serialize())));
      expect(copy.serialize()).toEqual(t.serialize());
      expect(() => TOOL_REGISTRY[id]!.deserialize({})).toThrow();
    }
  });
  it('quick shapes create pre-configured tools', () => {
    const oring = QUICK_SHAPES.find((q) => q.id === 'oring')!;
    const t = createTool(oring.tool, [], oring.init) as CircleTool;
    expect(t.s.mode).toBe('ring');
    const sq = QUICK_SHAPES.find((q) => q.id === 'squarePiece')!;
    expect((createTool(sq.tool, [], sq.init) as RectTool).s.square).toBe(true);
  });
});
