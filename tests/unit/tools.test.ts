import { describe, expect, it } from 'vitest';
import { makeTransform } from '../../src/core/calibration';
import { lengthUncertainty } from '../../src/core/uncertainty';
import type { ToolEnv } from '../../src/render/types';
import type { Vec } from '../../src/core/types';
import { RulerTool, defaultRulerState } from '../../src/tools/ruler/RulerTool';
import { GapRulerTool, defaultGapState } from '../../src/tools/gapRuler/GapRulerTool';
import { classifyContact, isBigContact } from '../../src/render/pointer';
import { TOOL_REGISTRY } from '../../src/tools/registry';

function env(over: Partial<ToolEnv> = {}): ToolEnv {
  const t = makeTransform({ pxPerMmX: 16, pxPerMmY: 16 }, 0, 2.625);
  return {
    transform: () => t,
    bounds: () => ({ x: 2, y: 2, w: 64, h: 140 }),
    placeBounds: () => ({ x: 2, y: 2, w: 64, h: 140 }),
    uncertainty: (L, dir, edges) =>
      lengthUncertainty({
        lengthMm: L,
        pxPerMm: t.pxPerMmAlong(dir),
        relCal: 0.001,
        screenProtector: 'none',
        edges,
      }).U,
    tickSnapMm: () => 0,
    snapPoints: () => [],
    otherAngles: () => [],
    angleSnap: () => true,
    haptic: () => {},
    unit: () => 'mm',
    fractionDen: () => 16,
    ...over,
  };
}

function ruler(kind: 'ruler' | 'splitRuler' | 'leapfrog' = 'ruler', e = env()): RulerTool {
  const r = new RulerTool(defaultRulerState(kind));
  r.attach(e);
  r.fit(e.bounds());
  return r;
}

function drag(t: RulerTool | GapRulerTool, id: string, from: Vec, to: Vec): void {
  const h = { id, kind: 'edge' as const, posMm: from };
  t.onDragStart(h, from);
  t.onDragMove(h, to, false);
  t.onDragEnd(h);
}

describe('ruler tool', () => {
  it('places itself inside the usable area', () => {
    const r = ruler();
    const b = env().bounds();
    for (const p of r.outline()) {
      expect(p[0]).toBeGreaterThanOrEqual(b.x - 1e-9);
      expect(p[0]).toBeLessThanOrEqual(b.x + b.w + 1e-9);
      expect(p[1]).toBeGreaterThanOrEqual(b.y - 1e-9);
    }
  });
  it('reads the distance between the markers', () => {
    const r = ruler();
    r.s.a = 10;
    r.s.b = 10;
    drag(r, 'b', [0, 0], [42.3, 0]);
    const [ro] = r.readouts();
    expect(ro.value).toBeCloseTo(42.3, 12);
    expect(ro.kind).toBe('length');
    expect(ro.uncertainty).toBeGreaterThan(0);
  });
  it('marker motion follows the ruler direction only', () => {
    const r = ruler();
    r.s.a = 10;
    r.s.b = 20;
    drag(r, 'b', [0, 0], [5, 30]); // perpendicular component ignored
    expect(r.readouts()[0].value).toBeCloseTo(15, 12);
  });
  it('has no drift: scale origin, zero and length are untouched after 1,000 marker drags', () => {
    const r = ruler();
    const before = JSON.stringify({ o: r.s.origin, z: r.s.zero, L: r.s.length, ang: r.s.angle });
    const a0 = r.s.a;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 1000; i++) {
      const id = i % 2 ? 'a' : 'b';
      drag(r, id, [0, 0], [rnd() * 20, rnd() * 5]);
    }
    expect(JSON.stringify({ o: r.s.origin, z: r.s.zero, L: r.s.length, ang: r.s.angle })).toBe(before);
    // A drag and its exact reverse inside one gesture returns to the same position.
    const h = { id: 'a', kind: 'edge' as const, posMm: [0, 0] as Vec };
    r.s.a = a0;
    r.onDragStart(h, [0, 0]);
    for (let i = 0; i < 1000; i++) r.onDragMove(h, [rnd() * 10, 0], false);
    r.onDragMove(h, [0, 0], false);
    r.onDragEnd(h);
    expect(r.s.a).toBe(a0);
  });
  it('clamps extension to the usable area', () => {
    const r = ruler();
    const h = { id: 'end', kind: 'point' as const, posMm: [0, 0] as Vec };
    r.onDragStart(h, [0, 0]);
    r.onDragMove(h, [500, 0], false);
    r.onDragEnd(h);
    const b = env().bounds();
    expect(r.P(r.s.length)[0]).toBeLessThanOrEqual(b.x + b.w + 1e-9);
  });
  it('snaps markers to ticks when enabled', () => {
    const r = ruler('ruler', env({ tickSnapMm: () => 1 }));
    r.s.a = 0;
    r.s.b = 10;
    drag(r, 'b', [0, 0], [2.2, 0]);
    expect(r.s.b).toBe(12);
  });
  it('snaps rotation to 90° and fits after rotate', () => {
    const r = ruler();
    r.rotateBy(89, r.center());
    r.fit(env().bounds());
    const h = { id: 'rot', kind: 'rotate' as const, posMm: [0, 0] as Vec };
    const c = r.center();
    r.onDragStart(h, [c[0] + 10, c[1]]);
    r.onDragMove(h, [c[0] + 10 * Math.cos(0.01), c[1] + 10 * Math.sin(0.01)], false);
    r.onDragEnd(h);
    expect(r.s.angle).toBe(90);
  });
  it('set exact value and zero', () => {
    const r = ruler();
    r.s.a = 5;
    expect(r.setExactValue('b', 25)).toBe(true);
    expect(r.readouts()[0].value).toBeCloseTo(25, 12);
    expect(r.setZeroAt('a')).toBe(true);
    expect(r.s.zero).toBe(5);
    expect(r.setExactValue('b', 9999)).toBe(false);
  });
  it('leapfrog sums segments and grows uncertainty as √N', () => {
    const r = ruler('leapfrog');
    r.s.a = 4;
    r.s.zero = 4;
    r.s.b = 54;
    const one = r.readouts()[0];
    r.mark();
    r.mark();
    r.mark();
    const four = r.readouts()[0];
    expect(four.value).toBeCloseTo(200, 9);
    expect(four.uncertainty).toBeGreaterThan(one.uncertainty);
    expect(four.uncertainty).toBeGreaterThanOrEqual(one.uncertainty * 1.5);
  });
  it('round-trips through the registry', () => {
    const r = ruler('splitRuler');
    const copy = TOOL_REGISTRY.splitRuler!.deserialize(r.serialize());
    expect(copy.serialize()).toEqual(r.serialize());
    expect(() => TOOL_REGISTRY.ruler!.deserialize({})).toThrow();
  });
});

describe('gap rulers', () => {
  function gap(): GapRulerTool {
    const g = new GapRulerTool(defaultGapState());
    g.attach(env());
    return g;
  }
  it('measures the gap between the edges and the marker length', () => {
    const g = gap();
    g.s.oA = 10;
    g.s.oB = -10;
    g.s.a = -5;
    g.s.b = 25;
    const [w, l, area] = g.readouts();
    expect(w.value).toBeCloseTo(20, 12);
    expect(l.value).toBeCloseTo(30, 12);
    expect(area.value).toBeCloseTo(600, 9);
  });
  it('moves each ruler perpendicular only and never crosses', () => {
    const g = gap();
    g.s.oA = 10;
    g.s.oB = -10;
    drag(g, 'rA', [0, 0], [3, 4]); // n points up (−y): moving +4 in y reduces the gap by 4
    expect(g.s.oA).toBeCloseTo(6, 12);
    drag(g, 'rA', [0, 0], [0, 500]);
    expect(g.s.oA).toBeGreaterThanOrEqual(g.s.oB);
  });
});

describe('ghost touch shield', () => {
  const base = {
    mode: 'normal' as const,
    big: false,
    sameToolAsDrag: false,
    dragActive: false,
    locked: false,
  };
  it('only contacts starting on a handle or body manipulate tools', () => {
    expect(classifyContact({ ...base, hit: 'handle' })).toBe('drag');
    expect(classifyContact({ ...base, hit: 'body' })).toBe('drag');
    expect(classifyContact({ ...base, hit: 'none' })).toBe('empty');
  });
  it('strict mode: handles only', () => {
    expect(classifyContact({ ...base, mode: 'strict', hit: 'body' })).toBe('ignore');
    expect(classifyContact({ ...base, mode: 'strict', hit: 'handle' })).toBe('drag');
  });
  it('big contacts (palm, metal part) are ignored', () => {
    expect(isBigContact({ pointerType: 'touch', widthMm: 20, heightMm: 18 }, 'normal')).toBe(true);
    expect(isBigContact({ pointerType: 'touch', widthMm: 8, heightMm: 8 }, 'normal')).toBe(false);
    expect(isBigContact({ pointerType: 'touch', widthMm: 20, heightMm: 18 }, 'off')).toBe(false);
    expect(classifyContact({ ...base, big: true, hit: 'handle' })).toBe('ignore');
  });
  it('second finger: twist on the same tool, precision elsewhere', () => {
    expect(classifyContact({ ...base, dragActive: true, hit: 'body', sameToolAsDrag: true })).toBe('twist');
    expect(classifyContact({ ...base, dragActive: true, hit: 'none' })).toBe('precision');
  });
  it('lock freezes tools', () => {
    expect(classifyContact({ ...base, locked: true, hit: 'handle' })).toBe('ignore');
  });
});
