// Circle · O-ring · Washer · Ring (§6.4).
// Creation: squeeze-to-fit (N/E/S/W sides move independently, the circle re-centres), centre → radius
// (centre drag + radius knob), 3-point and multi-point least-squares fit with ovality. Ring mode adds an
// inner circle, concentric by default.
import type { FeatureKind, Vec } from '../../core/types';
import { add, dist, fitShift, norm, scale, sub, type RectMm } from '../../core/geometry';
import { circleFrom3, fitCircle } from '../../core/geometry/fit';
import { roundUpOneSig } from '../../core/uncertainty';
import type { Handle, Readout, RenderContext, ToolAction, ToolInstance } from '../../render/types';
import { circlePoints, drawCross, drawKnob, drawOutline, drawTag, line } from '../../render/draw';
import { fmtLength } from '../../render/format';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../base';

export type CircleMode = 'circle' | 'ring' | 'points';
export type CirclePreset = 'none' | 'oring' | 'washer' | 'rod';

export interface CircleState {
  v: 1;
  id: string;
  tool: 'circle';
  n: number;
  placed: boolean;
  mode: CircleMode;
  preset: CirclePreset;
  c: Vec;
  r: number;
  ci: Vec;
  ri: number;
  concentric: boolean;
  pts: Vec[];
  lastRing: 'outer' | 'inner';
}

/** Knobs sit this far outside the rim so the finger never covers the edge being aligned. */
const KO = 6;
const DIRS: Record<string, Vec> = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] };
const DIAG: Vec = norm([1, -1]);

export function defaultCircleState(n = 1, mode: CircleMode = 'circle', preset: CirclePreset = 'none'): CircleState {
  return {
    v: 1,
    id: newId('cir'),
    tool: 'circle',
    n,
    placed: false,
    mode,
    preset,
    c: [0, 0],
    r: 20,
    ci: [0, 0],
    ri: 12,
    concentric: true,
    pts: [],
    lastRing: 'outer',
  };
}

export class CircleTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool = 'circle' as const;
  s: CircleState;
  private drag: { id: string; p0: Vec; s0: CircleState } | null = null;

  constructor(state: CircleState) {
    super();
    this.s = structuredClone(state);
    this.id = state.id;
  }

  get label(): string {
    return `${this.s.mode === 'ring' ? 'OD' : 'Ø'}${this.s.n}`;
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
    // Start big, then squeeze in onto the part (§6.4).
    s.r = clamp(Math.min(b.w, b.h) / 2 - KO - 4, 8, 45);
    s.c = [b.x + b.w / 2, b.y + b.h / 2];
    s.ri = s.r * 0.6;
    s.ci = [...s.c];
    if (s.mode === 'points') s.pts = this.seedPoints(3);
    s.placed = true;
  }

  private seedPoints(k: number): Vec[] {
    const s = this.s;
    return Array.from({ length: k }, (_, i) => {
      const a = (-90 + (i * 360) / k) * (Math.PI / 180);
      return [s.c[0] + s.r * Math.cos(a), s.c[1] + s.r * Math.sin(a)] as Vec;
    });
  }

  /** Recompute centre/radius from rim points (3-point exact, 4+ least squares). */
  private refitPoints(): void {
    const s = this.s;
    if (s.mode !== 'points' || s.pts.length < 3) return;
    const f = s.pts.length === 3 ? circleFrom3(s.pts[0], s.pts[1], s.pts[2]) : fitCircle(s.pts);
    if (f && f.r < 500) {
      s.c = f.c;
      s.r = f.r;
    }
  }

  outline(): Vec[] {
    const { c, r } = this.s;
    const k = r + KO + 1;
    return [
      [c[0] - k, c[1] - k],
      [c[0] + k, c[1] + k],
    ];
  }

  fit(b: RectMm): void {
    const s = this.s;
    if (s.mode === 'points') {
      s.pts = s.pts.map((p) => [clamp(p[0], b.x, b.x + b.w), clamp(p[1], b.y, b.y + b.h)] as Vec);
      this.refitPoints();
      return;
    }
    s.r = Math.min(s.r, Math.min(b.w, b.h) / 2 - KO - 1);
    s.ri = Math.min(s.ri, s.r - 0.3);
    const sh = fitShift(this.outline(), b);
    s.c = add(s.c, sh);
    s.ci = add(s.ci, sh);
  }

  rotateBy(): void {
    /* circles are rotation-invariant */
  }

  snapTargets(): Vec[] {
    return [this.s.c];
  }

  focusOf(id: string): Vec | null {
    const s = this.s;
    if (DIRS[id]) return add(s.c, scale(DIRS[id], s.r));
    if (id === 'R') return add(s.c, scale(DIAG, s.r));
    const lower = id.toUpperCase();
    if (id.length === 1 && DIRS[lower]) return add(s.ci, scale(DIRS[lower], s.ri));
    const m = /^p(\d+)$/.exec(id);
    if (m) return s.pts[Number(m[1])];
    return null;
  }

  private knobs(): [string, Vec][] {
    const s = this.s;
    if (s.mode === 'points') {
      return s.pts.map((p, i) => [`p${i}`, add(p, scale(norm(sub(p, s.c)), KO))] as [string, Vec]);
    }
    const out: [string, Vec][] = Object.entries(DIRS).map(([k, d]) => [k, add(s.c, scale(d, s.r + KO))] as [string, Vec]);
    out.push(['R', add(s.c, scale(DIAG, s.r + KO))]);
    if (s.mode === 'ring') {
      const ko = Math.min(KO, s.ri * 0.55);
      for (const [k, d] of Object.entries(DIRS)) out.push([k.toLowerCase(), add(s.ci, scale(d, s.ri - ko))]);
    }
    return out;
  }

  hitTest(p: Vec, tol: number): Handle | null {
    let best: Handle | null = null;
    let bd = Infinity;
    for (const [id, q] of this.knobs()) {
      const d = dist(p, q);
      if (d <= tol && d < bd) {
        bd = d;
        best = { id, kind: 'edge', posMm: q };
      }
    }
    if (best) return best;
    if (dist(p, this.s.c) <= this.s.r) return { id: 'body', kind: 'body', posMm: p };
    return null;
  }

  onDragStart(h: Handle, p: Vec): void {
    this.drag = { id: h.id, p0: p, s0: structuredClone(this.s) };
    if (h.id === h.id.toLowerCase() && h.id.length === 1) this.s.lastRing = 'inner';
    else if (h.id !== 'body') this.s.lastRing = 'outer';
  }

  onDragMove(h: Handle, p: Vec, _precision = false): void {
    const d = this.drag;
    if (!d) return;
    const s = this.s;
    const s0 = d.s0;
    const delta = sub(p, d.p0);
    if (h.id === 'body') {
      s.c = add(s0.c, delta);
      s.ci = add(s0.ci, delta);
      s.pts = s0.pts.map((q) => add(q, delta));
      return;
    }
    const pm = /^p(\d+)$/.exec(h.id);
    if (pm) {
      const i = Number(pm[1]);
      s.pts[i] = add(s0.pts[i], delta);
      this.refitPoints();
      return;
    }
    if (h.id === 'R') {
      const rim = add(add(s0.c, scale(DIAG, s0.r)), delta);
      s.r = Math.max(1, dist(rim, s0.c));
      if (s.mode === 'ring') s.ri = Math.min(s.ri, s.r - 0.3);
      return;
    }
    const outer = DIRS[h.id];
    if (outer) {
      // Squeeze: this side moves, the opposite side stays put; the circle re-centres.
      const axis = outer[0] !== 0 ? 0 : 1;
      const sign = outer[axis];
      const moving = s0.c[axis] + sign * s0.r + delta[axis];
      const fixed = s0.c[axis] - sign * s0.r;
      const r = Math.max(1, (moving - fixed) * sign * 0.5);
      const c: Vec = [...s0.c];
      c[axis] = fixed + sign * r;
      s.r = r;
      s.c = c;
      if (s.mode === 'ring' && s.concentric) s.ci = [...c];
      s.ri = Math.min(s.ri, s.r - 0.3);
      return;
    }
    const inner = DIRS[h.id.toUpperCase()];
    if (inner && s.mode === 'ring') {
      const axis = inner[0] !== 0 ? 0 : 1;
      const sign = inner[axis];
      const moving = s0.ci[axis] + sign * s0.ri + delta[axis];
      if (s.concentric) {
        s.ri = clamp((moving - s0.c[axis]) * sign, 0.3, s.r - 0.3);
        s.ci = [...s.c];
      } else {
        const fixed = s0.ci[axis] - sign * s0.ri;
        const ri = clamp((moving - fixed) * sign * 0.5, 0.3, s.r - 0.3);
        const ci: Vec = [...s0.ci];
        ci[axis] = fixed + sign * ri;
        s.ri = ri;
        s.ci = ci;
      }
    }
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  wheel(stepMm: number): void {
    const s = this.s;
    if (s.mode === 'points') return;
    if (s.mode === 'ring' && s.lastRing === 'inner') s.ri = clamp(s.ri + stepMm / 2, 0.3, s.r - 0.3);
    else s.r = Math.max(1, s.r + stepMm / 2);
  }

  setExactValue(handleId: string, valueMm: number): boolean {
    const s = this.s;
    if (!(valueMm > 0)) return false;
    if (handleId === handleId.toLowerCase() && handleId.length === 1 && s.mode === 'ring') {
      if (valueMm / 2 >= s.r) return false;
      s.ri = valueMm / 2;
      return true;
    }
    s.r = valueMm / 2;
    s.ri = Math.min(s.ri, s.r - 0.3);
    return true;
  }

  actions(): ToolAction[] {
    const s = this.s;
    const list: ToolAction[] = [
      {
        id: 'mode',
        labelKey: `circle.mode.${s.mode}`,
        run: () => {
          const order: CircleMode[] = ['circle', 'ring', 'points'];
          s.mode = order[(order.indexOf(s.mode) + 1) % order.length];
          if (s.mode === 'ring') {
            s.ci = [...s.c];
            s.ri = Math.min(s.ri, s.r * 0.7);
          }
          if (s.mode === 'points') s.pts = this.seedPoints(3);
        },
      },
    ];
    if (s.mode === 'ring') {
      list.push({
        id: 'concentric',
        labelKey: 'circle.concentric',
        active: s.concentric,
        run: () => {
          s.concentric = !s.concentric;
          if (s.concentric) s.ci = [...s.c];
        },
      });
    }
    if (s.mode === 'points') {
      list.push({ id: 'addPt', labelKey: 'circle.addPoint', run: () => this.addPoint() });
      list.push({
        id: 'removePt',
        labelKey: 'circle.removePoint',
        run: () => {
          if (s.pts.length > 3) s.pts.pop();
          this.refitPoints();
        },
      });
    }
    return list;
  }

  /** Add a rim point in the largest angular gap. */
  addPoint(): void {
    const s = this.s;
    const angs = s.pts.map((p) => Math.atan2(p[1] - s.c[1], p[0] - s.c[0])).sort((a, b) => a - b);
    let best = 0;
    let gap = -1;
    for (let i = 0; i < angs.length; i++) {
      const a = angs[i];
      const b = i + 1 < angs.length ? angs[i + 1] : angs[0] + Math.PI * 2;
      if (b - a > gap) {
        gap = b - a;
        best = a + (b - a) / 2;
      }
    }
    s.pts.push([s.c[0] + s.r * Math.cos(best), s.c[1] + s.r * Math.sin(best)]);
    this.refitPoints();
  }

  readouts(): Readout[] {
    const s = this.s;
    const diag: Vec = norm([1, 1]);
    const U = (d: number) => this.env.uncertainty(d, diag, 2);
    const D = 2 * s.r;
    if (s.mode === 'ring') {
      const d = 2 * s.ri;
      const UD = U(D);
      const Ud = U(d);
      const cs = (D - d) / 2;
      const odKind: FeatureKind = 'outerDiameter';
      return [
        { label: `OD${s.n}`, kind: odKind, value: D, uncertainty: UD, primary: true, unit: 'length', nameKey: 'kind.outerDiameter' },
        { label: `ID${s.n}`, kind: 'innerDiameter', value: d, uncertainty: Ud, unit: 'length', nameKey: 'kind.innerDiameter' },
        { label: `CS${s.n}`, kind: 'crossSection', value: cs, uncertainty: roundUpOneSig(Math.hypot(UD, Ud) / 2), unit: 'length', nameKey: 'kind.crossSection' },
        { label: 'Øm', kind: 'diameter', value: (D + d) / 2, uncertainty: roundUpOneSig(Math.hypot(UD, Ud) / 2), unit: 'length', nameKey: 'readout.meanDiameter' },
        {
          label: 'AR',
          kind: 'area',
          value: (Math.PI * (D * D - d * d)) / 4,
          uncertainty: roundUpOneSig((Math.PI / 2) * Math.hypot(D * UD, d * Ud)),
          unit: 'area',
          nameKey: 'readout.annulus',
        },
        ...(s.concentric ? [] : [{ label: 'e', kind: 'length' as const, value: dist(s.c, s.ci), uncertainty: UD, unit: 'length' as const, nameKey: 'readout.eccentricity' }]),
      ];
    }
    let UD = U(D);
    const notes: string[] = [];
    const extra: Readout[] = [];
    if (s.mode === 'points' && s.pts.length >= 4) {
      const f = fitCircle(s.pts);
      if (f) {
        UD = roundUpOneSig(Math.hypot(UD, 4 * f.rms * Math.sqrt(2 / f.n)));
        extra.push({ label: 'ov', kind: 'diameter', value: f.ovality, uncertainty: UD, unit: 'length', nameKey: 'readout.ovality' });
        extra.push({ label: 'rms', kind: 'radius', value: f.rms, uncertainty: UD / 2, unit: 'length', nameKey: 'readout.rms' });
      }
    }
    if (s.mode === 'points') notes.push(`n = ${s.pts.length}`);
    return [
      { label: `Ø${s.n}`, kind: 'diameter', value: D, uncertainty: UD, primary: true, unit: 'length', nameKey: 'kind.diameter', notes },
      { label: `R${s.n}`, kind: 'radius', value: s.r, uncertainty: roundUpOneSig(UD / 2), unit: 'length', nameKey: 'kind.radius' },
      ...extra,
      { label: 'C', kind: 'perimeter', value: Math.PI * D, uncertainty: roundUpOneSig(Math.PI * UD), unit: 'length', nameKey: 'readout.circumference' },
      { label: 'AR', kind: 'area', value: (Math.PI * D * D) / 4, uncertainty: roundUpOneSig((Math.PI / 2) * D * UD), unit: 'area', nameKey: 'readout.area' },
    ];
  }

  toMeasurements(): ToolMeasurement[] {
    const keep = new Set(['outerDiameter', 'innerDiameter', 'crossSection', 'diameter']);
    return this.readouts()
      .filter((r) => r.primary || (this.s.mode === 'ring' && keep.has(r.kind) && r.nameKey !== 'readout.meanDiameter'))
      .map((r) => ({ tool: this.tool, kind: r.kind, label: r.label, value: r.value, uncertainty: r.uncertainty, toolState: this.serialize() }));
  }

  serialize(): CircleState {
    return structuredClone(this.s);
  }

  render(rc: RenderContext): void {
    const s = this.s;
    const { ctx } = rc;
    const outer = circlePoints(s.c, s.r);
    if (s.mode === 'ring') {
      const inner = circlePoints(s.ci, s.ri).reverse();
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = rc.theme.accent;
      ctx.beginPath();
      for (const ring of [outer, inner]) {
        ring.forEach((p, i) => {
          const q = rc.mmToPx(p);
          if (i === 0) ctx.moveTo(q[0], q[1]);
          else ctx.lineTo(q[0], q[1]);
        });
        ctx.closePath();
      }
      ctx.fill('evenodd');
      ctx.restore();
      drawOutline(rc, outer, true, rc.theme.accent);
      drawOutline(rc, circlePoints(s.ci, s.ri), true, rc.theme.accent2);
    } else {
      drawOutline(rc, outer, true, rc.theme.accent);
    }
    drawCross(rc, s.c, rc.theme.ink);
    if (s.mode === 'ring' && !s.concentric) drawCross(rc, s.ci, rc.theme.accent2, 1.8);

    // Diameter dimension line through the centre.
    ctx.save();
    ctx.strokeStyle = rc.theme.ink;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([3 * rc.dpr, 3 * rc.dpr]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    line(ctx, rc.mmToPx([s.c[0] - s.r, s.c[1]]), rc.mmToPx([s.c[0] + s.r, s.c[1]]));
    ctx.stroke();
    ctx.restore();

    if (rc.inLoupe) return;
    const rs = this.readouts();
    const r = rs[0];
    drawTag(rc, `${r.label} ${fmtLength(r.value, r.uncertainty, rc.unit, rc.fractionDen)}`, [s.c[0], s.c[1] - Math.min(s.r * 0.45, 9)], [0, -1], rc.theme.ink, rc.theme.bg);
    if (s.mode === 'ring' && s.ri > 6) {
      const id = rs[1];
      drawTag(rc, `${id.label} ${fmtLength(id.value, id.uncertainty, rc.unit, rc.fractionDen)}`, [s.ci[0], s.ci[1] + Math.min(s.ri * 0.45, 6)], [0, -1], rc.theme.accent2, '#ffffff');
    }
    for (const [id, q] of this.knobs()) {
      const innerKnob = id.length === 1 && id === id.toLowerCase();
      const f = this.focusOf(id);
      if (f) {
        ctx.save();
        ctx.strokeStyle = innerKnob ? rc.theme.accent2 : rc.theme.accent;
        ctx.lineWidth = 1.5 * rc.dpr;
        ctx.beginPath();
        line(ctx, rc.mmToPx(f), rc.mmToPx(q));
        ctx.stroke();
        ctx.restore();
      }
      drawKnob(rc, q, innerKnob ? rc.theme.accent2 : id === 'R' ? '#334155' : rc.theme.accent, {
        active: rc.activeHandleId === id,
        glyph: id === 'R' ? 'extend' : undefined,
      });
    }
  }
}

export function isCircleState(x: unknown): x is CircleState {
  const o = x as CircleState;
  return !!o && o.tool === 'circle' && Array.isArray(o.c);
}
