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
    pointU: () => 0.08,
    relCal: () => 0.001,
    snapPoints: () => [],
    otherAngles: () => [],
    angleSnap: () => true,
    haptic: () => {},
    unit: () => 'mm',
    fractionDen: () => 16,
    ...over,
  };
}

function ruler(kind: 'ruler' | 'leapfrog' = 'ruler', e = env()): RulerTool {
  const r = new RulerTool(defaultRulerState(kind));
  r.attach(e);
  r.fit();
  return r;
}

function drag(t: RulerTool | GapRulerTool, id: string, from: Vec, to: Vec): void {
  const h = { id, kind: 'edge' as const, posMm: from };
  t.onDragStart(h, from);
  t.onDragMove(h, to, false);
  t.onDragEnd(h);
}

describe('ruler (two measuring lines)', () => {
  it('reads the distance between the lines', () => {
    const r = ruler();
    r.s.a = 10;
    r.s.b = 10;
    drag(r, 'b', [0, 0], [42.3, 7]); // perpendicular part ignored
    const [ro] = r.readouts();
    expect(ro.value).toBeCloseTo(42.3, 12);
    expect(ro.uncertainty).toBeGreaterThan(0);
  });
  it('keeps the region between the lines bright (spotlight clipped to the screen)', () => {
    const r = ruler();
    r.s.a = 10;
    r.s.b = 40;
    const [poly] = r.spotlight()!;
    const xs = poly.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(2 + 10, 9);
    expect(Math.max(...xs)).toBeCloseTo(2 + 40, 9);
  });
  it('drag in the dimmed area moves the nearer line; inside the bright region is protected', () => {
    const r = ruler();
    r.s.a = 10;
    r.s.b = 40;
    const y = 70;
    expect(r.indirect([2 + 25, y])).toBeNull();
    const left = r.indirect([2 + 3, y])!;
    expect(left.id).toBe('ind:a');
    drag(r, left.id, [5, y], [8, y]);
    expect(r.s.a).toBeCloseTo(13, 12);
    expect(r.indirect([2 + 55, y])!.id).toBe('ind:b');
  });
  it('lines never leave the usable area', () => {
    const r = ruler();
    drag(r, 'b', [0, 0], [500, 0]);
    expect(r.P(r.s.b)[0]).toBeLessThanOrEqual(2 + 64);
  });
  it('has no drift after 1,000 drags and a drag back returns exactly', () => {
    const r = ruler();
    const a0 = r.s.a;
    const h = { id: 'a', kind: 'edge' as const, posMm: [0, 0] as Vec };
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    r.onDragStart(h, [0, 0]);
    for (let i = 0; i < 1000; i++) r.onDragMove(h, [rnd() * 10, 0], false);
    r.onDragMove(h, [0, 0], false);
    r.onDragEnd(h);
    expect(r.s.a).toBe(a0);
  });
  it('snaps the distance to ticks when enabled', () => {
    const r = ruler('ruler', env({ tickSnapMm: () => 1 }));
    r.s.a = 10;
    r.s.b = 20;
    drag(r, 'b', [0, 0], [2.2, 0]);
    expect(r.s.b - r.s.a).toBe(12);
  });
  it('rotate 90° measures the other axis; flip swaps the zero line', () => {
    const r = ruler();
    r.actions()
      .find((a) => a.id === 'rot90')!
      .run();
    expect(Math.abs(r.s.angle)).toBe(90);
    const [a, b] = [r.s.a, r.s.b];
    r.actions()
      .find((a2) => a2.id === 'flip')!
      .run();
    expect([r.s.a, r.s.b]).toEqual([b, a]);
  });
  it('set exact value', () => {
    const r = ruler();
    r.s.a = 5;
    expect(r.setExactValue('b', 25)).toBe(true);
    expect(r.readouts()[0].value).toBeCloseTo(25, 12);
    expect(r.setExactValue('b', 9999)).toBe(false);
  });
  it('two fingers place the lines at the fingers', () => {
    const r = new RulerTool(defaultRulerState('ruler'));
    r.attach(env());
    r.placeAt([20, 30], [22, 90], env().bounds());
    expect(Math.abs(r.s.angle)).toBe(90);
    expect(r.readouts()[0].value).toBeCloseTo(60, 9);
  });
  it('leapfrog opens edge to edge and sums segments with √N uncertainty', () => {
    const r = ruler('leapfrog');
    expect(r.P(r.s.a)[0]).toBeCloseTo(2 + 1.5, 9);
    expect(r.P(r.s.b)[0]).toBeCloseTo(66 - 1.5, 9);
    r.s.a = 4;
    r.s.b = 54;
    const one = r.readouts()[0];
    r.mark();
    r.mark();
    r.mark();
    const four = r.readouts()[0];
    expect(four.value).toBeCloseTo(200, 9);
    expect(four.uncertainty).toBeGreaterThanOrEqual(one.uncertainty * 1.5);
    r.undoMark();
    expect(r.readouts()[0].value).toBeCloseTo(150, 9);
  });
  it('round-trips through the registry; old v1 states are rejected', () => {
    const r = ruler('leapfrog');
    const copy = TOOL_REGISTRY.leapfrog!.deserialize(r.serialize());
    expect(copy.serialize()).toEqual(r.serialize());
    expect(() => TOOL_REGISTRY.ruler!.deserialize({ v: 1, origin: [0, 0], length: 1 })).toThrow();
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
