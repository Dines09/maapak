// Radius (fillet) gauge (§6.8.2): concave / convex template of radius R, or a 3-point arc fit → R.
import type { Vec } from '../../core/types';
import {
  add,
  dirOf,
  dist,
  fitShift,
  normAngle,
  rad2deg,
  rotateAbout,
  scale,
  snapAngle,
  sub,
  type RectMm,
} from '../../core/geometry';
import { arcSpan, circleFrom3, fitCircle } from '../../core/geometry/fit';
import { roundUpOneSig } from '../../core/uncertainty';
import type {
  DrawingEntities,
  Handle,
  Readout,
  RenderContext,
  ToolAction,
  ToolInstance,
  ToolPreset,
} from '../../render/types';
import { drawCross, drawKnob, drawOutline } from '../../render/draw';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../base';

export interface RadiusState {
  v: 1;
  id: string;
  tool: 'radiusGauge';
  n: number;
  placed: boolean;
  mode: 'template' | 'points';
  convex: boolean;
  /** Template: centre of the arc, radius and the direction of the arc's middle (deg). */
  c: Vec;
  r: number;
  angle: number;
  pts: [Vec, Vec, Vec];
}

const SPAN = 100; // template arc span (deg)

export function defaultRadiusState(n = 1): RadiusState {
  return {
    v: 1,
    id: newId('rad'),
    tool: 'radiusGauge',
    n,
    placed: false,
    mode: 'template',
    convex: false,
    c: [0, 0],
    r: 10,
    angle: -45,
    pts: [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  };
}

export class RadiusTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool = 'radiusGauge' as const;
  s: RadiusState;
  private drag: { id: string; p0: Vec; s0: RadiusState; snapped: number | null } | null = null;

  constructor(state: RadiusState) {
    super();
    this.s = structuredClone(state);
    this.id = state.id;
  }

  get label(): string {
    return `R${this.s.n}`;
  }
  set label(v: string) {
    const m = /(\d+)$/.exec(v);
    if (m) this.s.n = Number(m[1]);
  }

  attach(env: Parameters<BaseTool['attach']>[0]): void {
    super.attach(env);
    if (this.s.placed) return;
    const b = env.placeBounds();
    const s = this.s;
    s.c = [b.x + b.w * 0.55, b.y + b.h * 0.55];
    s.r = clamp(b.w * 0.25, 4, 25);
    const c = s.c;
    s.pts = [[c[0] - s.r, c[1]], add(c, scale(dirOf(-45), s.r)), [c[0], c[1] - s.r]];
    s.placed = true;
  }

  private circle(): { c: Vec; r: number } {
    if (this.s.mode === 'points') {
      const f = circleFrom3(...this.s.pts);
      if (f) return f;
    }
    return { c: this.s.c, r: this.s.r };
  }

  private arcPts(c: Vec, r: number, mid: number, span: number): Vec[] {
    return Array.from({ length: 41 }, (_, i) => add(c, scale(dirOf(mid - span / 2 + (i * span) / 40), r)));
  }

  outline(): Vec[] {
    const s = this.s;
    return s.mode === 'points' ? [...s.pts] : this.arcPts(s.c, s.r, s.angle, SPAN);
  }

  fit(b: RectMm): void {
    const s = this.s;
    if (s.mode === 'points') {
      s.pts = s.pts.map(
        (p) => [clamp(p[0], b.x, b.x + b.w), clamp(p[1], b.y, b.y + b.h)] as Vec,
      ) as RadiusState['pts'];
      return;
    }
    s.c = add(s.c, fitShift(this.arcPts(s.c, s.r, s.angle, SPAN), b));
  }

  rotateBy(deg: number, pivot: Vec): void {
    this.s.c = rotateAbout(this.s.c, pivot, deg);
    this.s.angle = normAngle(this.s.angle + deg);
  }

  angle(): number {
    return this.s.angle;
  }

  private knobs(): [string, Vec][] {
    const s = this.s;
    if (s.mode === 'points') return s.pts.map((p, i) => [`p${i}`, p] as [string, Vec]);
    return [
      ['r', add(s.c, scale(dirOf(s.angle), s.r))],
      ['rot', add(s.c, scale(dirOf(s.angle + SPAN / 2), s.r))],
      ['c', s.c],
    ];
  }

  focusOf(id: string): Vec | null {
    return this.knobs().find(([k]) => k === id)?.[1] ?? null;
  }

  hitTest(p: Vec, tol: number): Handle | null {
    let best: Handle | null = null;
    let bd = Infinity;
    for (const [id, q] of this.knobs()) {
      const d = dist(p, q);
      if (d <= tol && d < bd) {
        bd = d;
        best = { id, kind: id === 'rot' ? 'rotate' : 'point', posMm: q };
      }
    }
    return best;
  }

  onDragStart(h: Handle, p: Vec): void {
    this.drag = { id: h.id, p0: p, s0: structuredClone(this.s), snapped: null };
  }

  onDragMove(h: Handle, p: Vec, _precision = false): void {
    const d = this.drag;
    if (!d) return;
    const s = this.s;
    const s0 = d.s0;
    const delta = sub(p, d.p0);
    const m = /^p(\d)$/.exec(h.id);
    if (m) {
      s.pts[Number(m[1])] = add(s0.pts[Number(m[1])], delta);
    } else if (h.id === 'r') {
      s.r = Math.max(0.5, dist(add(add(s0.c, scale(dirOf(s0.angle), s0.r)), delta), s0.c));
    } else if (h.id === 'rot') {
      let a = normAngle(rad2deg(Math.atan2(p[1] - s0.c[1], p[0] - s0.c[0])) - SPAN / 2);
      if (this.env.angleSnap()) {
        const [sa, ok] = snapAngle(a, 45, 3);
        if (ok) {
          if (d.snapped !== sa) this.snapHaptic();
          d.snapped = sa;
          a = sa;
        } else d.snapped = null;
      }
      s.angle = a;
    } else s.c = add(s0.c, delta);
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  wheel(stepMm: number): void {
    if (this.s.mode === 'template') this.s.r = Math.max(0.5, this.s.r + stepMm);
  }

  presets(): ToolPreset[] {
    const s = this.s;
    if (s.mode !== 'template') return [];
    return [1, 2, 3, 5, 8, 10, 15, 20].map((r) => ({
      id: `r${r}`,
      label: `R${r}`,
      active: Math.abs(s.r - r) < 0.01,
      run: () => (s.r = r),
    }));
  }

  actions(): ToolAction[] {
    const s = this.s;
    return [
      {
        id: 'mode',
        labelKey: s.mode === 'template' ? 'radius.toPoints' : 'radius.toTemplate',
        run: () => (s.mode = s.mode === 'template' ? 'points' : 'template'),
      },
      ...(s.mode === 'template'
        ? [
            {
              id: 'convex',
              labelKey: s.convex ? 'radius.concave' : 'radius.convex',
              run: () => (s.convex = !s.convex),
            },
          ]
        : []),
    ];
  }

  setExactValue(_h: string, v: number): boolean {
    if (!(v > 0)) return false;
    this.s.r = v;
    return true;
  }

  readouts(): Readout[] {
    const { c, r } = this.circle();
    const s = this.s;
    let U = this.env.uncertainty(2 * r, [1, 1], 2) / 2;
    const notes: string[] = [];
    if (s.mode === 'points') {
      // Three points on a short arc extrapolate: the fit covariance grows as the arc shrinks.
      const f = fitCircle(s.pts, 30, this.env.pointU());
      if (f) U = Math.hypot(U, 2 * f.uR);
      const span = arcSpan(s.pts, c);
      notes.push(`arc ${Math.round(span)}°`);
    }
    U = roundUpOneSig(U);
    return [
      {
        label: `R${s.n}`,
        kind: 'radius',
        value: r,
        uncertainty: U,
        primary: true,
        unit: 'length',
        nameKey: 'kind.radius',
        notes,
      },
      {
        label: 'Ø',
        kind: 'diameter',
        value: 2 * r,
        uncertainty: roundUpOneSig(2 * U),
        unit: 'length',
        nameKey: 'kind.diameter',
      },
    ];
  }

  toMeasurements(): ToolMeasurement[] {
    const [r] = this.readouts();
    return [
      {
        tool: this.tool,
        kind: r.kind,
        label: r.label,
        value: r.value,
        uncertainty: r.uncertainty,
        toolState: this.serialize(),
      },
    ];
  }

  toDrawing(): DrawingEntities {
    const { r } = this.circle();
    return {
      views: {
        top: {
          outline: [{ type: 'arc', center: [0, 0], r, a0: -100, a1: -10 }],
          dims: [
            {
              kind: 'radius',
              label: `R${this.s.n}`,
              value: r,
              uncertainty: 0,
              type: 'radius',
              center: [0, 0],
              r,
              dirDeg: 55,
            },
          ],
        },
      },
    };
  }

  serialize(): RadiusState {
    return structuredClone(this.s);
  }

  render(rc: RenderContext): void {
    const s = this.s;
    const { c, r } = this.circle();
    if (s.mode === 'template') {
      const arc = this.arcPts(c, r, s.angle, SPAN);
      // Template blade: the material sits outside (concave) or inside (convex) the arc.
      const blade = s.convex ? [c, ...arc] : [...arc, ...this.arcPts(c, r + 6, s.angle, SPAN).reverse()];
      drawOutline(rc, blade, true, rc.theme.accent, 'rgba(148,163,184,0.55)');
    } else {
      drawOutline(
        rc,
        this.arcPts(c, r, rad2deg(Math.atan2(s.pts[1][1] - c[1], s.pts[1][0] - c[0])), 360),
        true,
        rc.theme.accent,
      );
      drawCross(rc, c, rc.theme.ink);
    }
    if (rc.inLoupe) return;
    for (const [id, q] of this.knobs()) {
      drawKnob(rc, q, id === 'rot' ? '#64748b' : rc.theme.accent2, {
        active: rc.activeHandleId === id,
        glyph: id === 'rot' ? 'rotate' : id === 'r' ? 'extend' : undefined,
      });
    }
  }
}

export function isRadiusState(x: unknown): x is RadiusState {
  const o = x as RadiusState;
  return !!o && o.tool === 'radiusGauge' && typeof o.r === 'number';
}
