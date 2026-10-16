// Protractor & angles (§6.3): half-moon 0–180° with double scale, 360° mode, and a two-line angle
// (two lines laid along two edges; the angle is computed even if they meet off-screen).
import type { Vec } from '../../core/types';
import {
  add,
  clipLineToRect,
  dirOf,
  dist,
  distToSegment,
  fitShift,
  inRect,
  lineIntersection,
  normAngle,
  rad2deg,
  rotateAbout,
  scale,
  snapAngle,
  sub,
  type RectMm,
} from '../../core/geometry';
import { angleBetween, clipPolygonToRect } from '../../core/geometry/fit';
import { angleUncertaintyDeg } from '../../core/uncertainty';
import type { Handle, Readout, RenderContext, ToolAction, ToolInstance } from '../../render/types';
import { SKINS, effectiveBody } from '../../render/skins';
import { inkFor } from '../../core/color';
import { drawKnob, drawMarkerLine, drawScale, drawTag, drawText, line } from '../../render/draw';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../base';
import { fmtAngle } from '../../render/format';

export type ProtractorMode = 'half' | 'full' | 'twoLine';
export const SNAP_STEPS = [0, 0.5, 1, 5, 15] as const;
export type SnapStep = (typeof SNAP_STEPS)[number];

export interface ProtractorState {
  v: 1;
  id: string;
  tool: 'protractor';
  n: number;
  placed: boolean;
  mode: ProtractorMode;
  vertex: Vec;
  /** Baseline direction (deg, screen). */
  base: number;
  /** Measured angle, counter-clockwise from the baseline (deg). */
  phi: number;
  R: number;
  arm1: number;
  arm2: number;
  /** Two-line mode: p0–p1 and p2–p3. */
  pts: [Vec, Vec, Vec, Vec];
  snap: SnapStep;
}

export function defaultProtractorState(n = 1): ProtractorState {
  return {
    v: 1,
    id: newId('pro'),
    tool: 'protractor',
    n,
    placed: false,
    mode: 'half',
    vertex: [0, 0],
    base: 0,
    phi: 60,
    R: 32,
    arm1: 50,
    arm2: 50,
    pts: [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    snap: 0,
  };
}

/** Direction of an angle measured counter-clockwise on screen (y points down). */
const ccw = (base: number, a: number): Vec => dirOf(base - a);

export class ProtractorTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool = 'protractor' as const;
  s: ProtractorState;
  private drag: { id: string; p0: Vec; s0: ProtractorState; snapped: number | null } | null = null;

  constructor(state: ProtractorState) {
    super();
    this.s = structuredClone(state);
    this.id = state.id;
  }

  get label(): string {
    return `A${this.s.n}`;
  }
  set label(v: string) {
    const m = /(\d+)$/.exec(v);
    if (m) this.s.n = Number(m[1]);
  }

  angle(): number {
    return this.s.base;
  }

  private baseEnd(): Vec {
    return add(this.s.vertex, scale(dirOf(this.s.base), this.s.arm1));
  }
  private armEnd(): Vec {
    return add(this.s.vertex, scale(ccw(this.s.base, this.s.phi), this.s.arm2));
  }

  attach(env: Parameters<BaseTool['attach']>[0]): void {
    super.attach(env);
    if (this.s.placed) return;
    const b = env.placeBounds();
    const s = this.s;
    // Big by default (§6.3): baseline along the long side, the half-disc opening to the right.
    if (b.h > b.w * 1.2) {
      s.R = clamp(Math.min(b.w - 8, b.h / 2 - 4), 20, 75);
      s.base = 90;
      s.vertex = [b.x + 4, b.y + b.h / 2];
    } else {
      s.R = clamp(Math.min(b.w / 2 - 4, b.h - 8), 20, 75);
      s.base = 0;
      s.vertex = [b.x + b.w / 2, b.y + b.h - 4];
    }
    s.arm1 = s.R;
    s.arm2 = s.R;
    const c: Vec = [b.x + b.w / 2, b.y + b.h / 2];
    s.pts = [
      [c[0] - 22, c[1] + 14],
      [c[0] + 22, c[1] + 14],
      [c[0] - 18, c[1] - 2],
      [c[0] + 14, c[1] - 26],
    ];
    s.placed = true;
  }

  outline(): Vec[] {
    const s = this.s;
    if (s.mode === 'twoLine') return [...s.pts];
    const u = dirOf(s.base);
    const n: Vec = [u[1], -u[0]];
    const pts = [
      add(s.vertex, scale(u, s.R)),
      add(s.vertex, scale(u, -s.R)),
      add(s.vertex, scale(n, s.R)),
      this.baseEnd(),
      this.armEnd(),
    ];
    if (s.mode === 'full') pts.push(add(s.vertex, scale(n, -s.R)));
    return pts;
  }

  fit(b: RectMm): void {
    const s = this.s;
    if (s.mode === 'twoLine') {
      s.pts = s.pts.map((p) => [
        clamp(p[0], b.x, b.x + b.w),
        clamp(p[1], b.y, b.y + b.h),
      ]) as ProtractorState['pts'];
      return;
    }
    for (let i = 0; i < 25; i++) {
      s.vertex = add(s.vertex, fitShift(this.outline(), b));
      if (this.outline().every((p) => inRect(p, b, 0.01))) return;
      s.R = Math.max(12, s.R * 0.92);
      s.arm1 = Math.max(s.R * 0.6, s.arm1 * 0.92);
      s.arm2 = Math.max(s.R * 0.6, s.arm2 * 0.92);
    }
  }

  /** Bright angular sector between the baseline and the measuring arm; the rest is dimmed. */
  spotlight(): Vec[][] | null {
    const s = this.s;
    if (s.mode === 'twoLine') return null;
    const b = this.env.bounds();
    const R = Math.hypot(b.w, b.h) * 2;
    const pts: Vec[] = [s.vertex];
    const n = Math.max(2, Math.ceil(s.phi / 3));
    for (let k = 0; k <= n; k++) pts.push(add(s.vertex, scale(ccw(s.base, (k / n) * s.phi), R)));
    return [clipPolygonToRect(pts, b)];
  }

  /** Drag from the dimmed area: the measuring arm follows the finger's direction from the vertex. */
  indirect(p: Vec): Handle | null {
    const s = this.s;
    if (s.mode === 'twoLine' || dist(p, s.vertex) < 8) return null;
    const a = normAngle(s.base - rad2deg(Math.atan2(p[1] - s.vertex[1], p[0] - s.vertex[0])));
    const inside = s.mode === 'half' ? a >= 0 && a <= s.phi : (a + 360) % 360 <= s.phi;
    if (inside) return null;
    return { id: 'ind:arm', kind: 'point', posMm: p };
  }

  rotateBy(deg: number, pivot: Vec): void {
    const s = this.s;
    s.vertex = rotateAbout(s.vertex, pivot, deg);
    s.pts = s.pts.map((p) => rotateAbout(p, pivot, deg)) as ProtractorState['pts'];
    s.base = normAngle(s.base + deg);
  }

  snapTargets(): Vec[] {
    return this.s.mode === 'twoLine' ? [...this.s.pts] : [this.s.vertex];
  }

  focusOf(id: string): Vec | null {
    const s = this.s;
    if (id === 'vtx') return s.vertex;
    if (id === 'arm') return add(s.vertex, scale(ccw(s.base, s.phi), Math.min(s.arm2, s.R * 0.9)));
    if (id === 'base') return add(s.vertex, scale(dirOf(s.base), Math.min(s.arm1, s.R * 0.9)));
    const m = /^p(\d)$/.exec(id);
    return m ? s.pts[Number(m[1])] : null;
  }

  hitTest(p: Vec, tol: number): Handle | null {
    const s = this.s;
    if (s.mode === 'twoLine') {
      let best: Handle | null = null;
      let bd = Infinity;
      s.pts.forEach((q, i) => {
        const d = dist(p, q);
        if (d <= tol && d < bd) {
          bd = d;
          best = { id: `p${i}`, kind: 'point', posMm: q };
        }
      });
      if (best) return best;
      if (distToSegment(p, s.pts[0], s.pts[1]) <= tol * 0.5) return { id: 'l0', kind: 'body', posMm: p };
      if (distToSegment(p, s.pts[2], s.pts[3]) <= tol * 0.5) return { id: 'l1', kind: 'body', posMm: p };
      return null;
    }
    const cands: [string, Vec, Handle['kind']][] = [
      ['arm', this.armEnd(), 'rotate'],
      ['base', this.baseEnd(), 'rotate'],
      ['vtx', s.vertex, 'point'],
    ];
    let best: Handle | null = null;
    let bd = Infinity;
    for (const [id, q, kind] of cands) {
      const d = dist(p, q);
      if (d <= tol && d < bd) {
        bd = d;
        best = { id, kind, posMm: q };
      }
    }
    if (best) return best;
    const d = sub(p, s.vertex);
    const r = Math.hypot(d[0], d[1]);
    const a = normAngle(s.base - rad2deg(Math.atan2(d[1], d[0])));
    if (r <= s.R && (s.mode === 'full' || (a >= -2 && a <= 182)))
      return { id: 'body', kind: 'body', posMm: p };
    return null;
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
    if (h.id === 'vtx' || h.id === 'body') {
      s.vertex = add(s0.vertex, delta);
      return;
    }
    if (h.id === 'l0' || h.id === 'l1') {
      const i = h.id === 'l0' ? 0 : 2;
      s.pts[i] = add(s0.pts[i], delta);
      s.pts[i + 1] = add(s0.pts[i + 1], delta);
      return;
    }
    const pm = /^p(\d)$/.exec(h.id);
    if (pm) {
      const i = Number(pm[1]);
      s.pts[i] = add(s0.pts[i], delta);
      return;
    }
    if (h.id === 'ind:arm') {
      this.armTo(p, d);
      return;
    }
    const target = add(h.id === 'arm' ? this.endOf(s0, 'arm') : this.endOf(s0, 'base'), delta);
    const v = sub(target, s.vertex);
    const len = Math.max(s.R * 0.5, Math.hypot(v[0], v[1]));
    const dirDeg = rad2deg(Math.atan2(v[1], v[0]));
    if (h.id === 'base') {
      let base = dirDeg;
      if (this.env.angleSnap()) {
        const [b, ok] = snapAngle(base, 15, 2);
        if (ok) {
          if (d.snapped !== b) this.snapHaptic();
          d.snapped = b;
          base = b;
        } else d.snapped = null;
      }
      s.base = normAngle(base);
      s.arm1 = len;
    } else {
      let phi = normAngle(s.base - dirDeg);
      if (s.mode === 'half') {
        if (phi < 0) phi = phi < -90 ? 180 : 0;
      } else if (phi < 0) phi += 360;
      if (s.snap > 0) {
        const q = Math.round(phi / s.snap) * s.snap;
        if (q !== d.snapped && q % 15 === 0) this.snapHaptic();
        d.snapped = q;
        phi = q;
      }
      s.phi = phi;
      s.arm2 = len;
    }
  }

  /** Point the measuring arm at p (absolute direction). */
  private armTo(p: Vec, d: NonNullable<ProtractorTool['drag']>): void {
    const s = this.s;
    let phi = normAngle(s.base - rad2deg(Math.atan2(p[1] - s.vertex[1], p[0] - s.vertex[0])));
    if (s.mode === 'half') {
      if (phi < 0) phi = phi < -90 ? 180 : 0;
    } else if (phi < 0) phi += 360;
    if (s.snap > 0) {
      const q = Math.round(phi / s.snap) * s.snap;
      if (q !== d.snapped && q % 15 === 0) this.snapHaptic();
      d.snapped = q;
      phi = q;
    }
    s.phi = phi;
  }

  private endOf(st: ProtractorState, which: 'arm' | 'base'): Vec {
    return which === 'arm'
      ? add(st.vertex, scale(ccw(st.base, st.phi), st.arm2))
      : add(st.vertex, scale(dirOf(st.base), st.arm1));
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  wheel(stepMm: number): void {
    const s = this.s;
    if (s.mode === 'twoLine') return;
    s.phi = clamp(s.phi + Math.sign(stepMm) * 0.1, 0, s.mode === 'half' ? 180 : 359.9);
  }

  /** Two-line angle (0–180°). */
  lineAngle(): number {
    const [a, b, c, d] = this.s.pts;
    return angleBetween(sub(b, a), sub(d, c));
  }

  actions(): ToolAction[] {
    const s = this.s;
    const modes: ProtractorMode[] = ['half', 'full', 'twoLine'];
    return [
      {
        id: 'mode',
        labelKey: `protractor.mode.${s.mode}`,
        run: () => {
          s.mode = modes[(modes.indexOf(s.mode) + 1) % modes.length];
          if (s.mode === 'half' && s.phi > 180) s.phi = 360 - s.phi;
        },
      },
      {
        id: 'snap',
        labelKey: `protractor.snap.${String(s.snap).replace('.', '_')}`,
        run: () => (s.snap = SNAP_STEPS[(SNAP_STEPS.indexOf(s.snap) + 1) % SNAP_STEPS.length]),
      },
      { id: 'rot90', labelKey: 'action.rotate90', run: () => this.rotateBy(90, s.vertex) },
    ];
  }

  setExactValue(handleId: string, valueMm: number): boolean {
    const s = this.s;
    if (handleId === 'arm') {
      s.arm2 = Math.max(5, valueMm);
      return true;
    }
    if (handleId === 'base') {
      s.arm1 = Math.max(5, valueMm);
      return true;
    }
    return false;
  }

  readouts(): Readout[] {
    const s = this.s;
    const u = this.env.pointU();
    if (s.mode === 'twoLine') {
      const [a, b, c, d] = s.pts;
      const th = this.lineAngle();
      const U = angleUncertaintyDeg(u, [dist(a, b), dist(c, d)]);
      return [
        {
          label: `A${s.n}`,
          kind: 'angle',
          value: th,
          uncertainty: U,
          primary: true,
          unit: 'angle',
          nameKey: 'readout.angle',
        },
        {
          label: `A${s.n}′`,
          kind: 'angle',
          value: 180 - th,
          uncertainty: U,
          unit: 'angle',
          nameKey: 'readout.supplementary',
        },
      ];
    }
    const U = angleUncertaintyDeg(u, [s.arm1, s.arm2]);
    const out: Readout[] = [
      {
        label: `A${s.n}`,
        kind: 'angle',
        value: s.phi,
        uncertainty: U,
        primary: true,
        unit: 'angle',
        nameKey: 'readout.angle',
      },
    ];
    if (s.phi <= 90)
      out.push({
        label: 'c',
        kind: 'angle',
        value: 90 - s.phi,
        uncertainty: U,
        unit: 'angle',
        nameKey: 'readout.complementary',
      });
    if (s.phi <= 180)
      out.push({
        label: 's',
        kind: 'angle',
        value: 180 - s.phi,
        uncertainty: U,
        unit: 'angle',
        nameKey: 'readout.supplementary',
      });
    out.push({
      label: 'r',
      kind: 'angle',
      value: 360 - s.phi,
      uncertainty: U,
      unit: 'angle',
      nameKey: 'readout.reflex',
    });
    const dir2 = ccw(s.base, s.phi);
    out.push({
      label: `L${s.n}`,
      kind: 'length',
      value: s.arm2,
      uncertainty: this.env.uncertainty(s.arm2, dir2, 2),
      unit: 'length',
      nameKey: 'readout.arm',
    });
    return out;
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

  serialize(): ProtractorState {
    return structuredClone(this.s);
  }

  // ---------- rendering ----------

  render(rc: RenderContext): void {
    if (this.s.mode === 'twoLine') this.renderTwoLine(rc);
    else this.renderProtractor(rc);
  }

  private renderProtractor(rc: RenderContext): void {
    const { ctx } = rc;
    const s = this.s;
    const skin = SKINS.acrylic;
    const body = effectiveBody(skin, rc.theme.bg);
    const ink = inkFor(body, '#0a1a33');
    const V = s.vertex;
    const span = s.mode === 'full' ? 360 : 180;

    // Disc (drawn as a polygon so per-axis calibration is respected).
    ctx.save();
    ctx.beginPath();
    const steps = 90;
    for (let k = 0; k <= steps; k++) {
      const p = rc.mmToPx(add(V, scale(ccw(s.base, (k / steps) * span), s.R)));
      if (k === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
    ctx.fillStyle = skin.body;
    ctx.globalAlpha = 0.45;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = rc.selected ? 2 * rc.dpr : 1;
    ctx.strokeStyle = rc.selected ? rc.theme.accent : 'rgba(10,26,51,0.6)';
    ctx.stroke();

    // Degree scale: 1° ticks, 5° and 10° longer; outer row CCW, inner row reversed.
    ctx.strokeStyle = ink;
    for (const w of [1, 2]) {
      ctx.beginPath();
      ctx.lineWidth = w;
      for (let k = 0; k < (s.mode === 'full' ? 360 : 181); k++) {
        const len = k % 10 === 0 ? 3.6 : k % 5 === 0 ? 2.6 : 1.5;
        if ((k % 10 === 0 ? 2 : 1) !== w) continue;
        const d = ccw(s.base, k);
        line(ctx, rc.mmToPx(add(V, scale(d, s.R))), rc.mmToPx(add(V, scale(d, s.R - len))));
      }
      ctx.stroke();
    }
    if (rc.inLoupe) {
      ctx.beginPath();
      ctx.lineWidth = 1;
      for (let k = 0; k < span * 2; k++) {
        if (k % 2 === 0) continue;
        const d = ccw(s.base, k / 2);
        line(ctx, rc.mmToPx(add(V, scale(d, s.R))), rc.mmToPx(add(V, scale(d, s.R - 0.9))));
      }
      ctx.stroke();
    }
    ctx.restore();
    for (let k = 0; k <= (s.mode === 'full' ? 350 : 180); k += 10) {
      const d = ccw(s.base, k);
      drawText(rc, String(k), add(V, scale(d, s.R - 6)), d, { sizeMm: s.R > 40 ? 2.6 : 2, color: ink });
      if (s.mode === 'half')
        drawText(rc, String(180 - k), add(V, scale(d, s.R - 8.6)), d, {
          sizeMm: 1.6,
          color: ink,
          weight: 500,
        });
    }

    // Baseline across the diameter and centre crosshair.
    const u = dirOf(s.base);
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    line(ctx, rc.mmToPx(add(V, scale(u, -s.R))), rc.mmToPx(add(V, scale(u, s.R))));
    const n: Vec = [u[1], -u[0]];
    line(ctx, rc.mmToPx(add(V, scale(n, -3))), rc.mmToPx(add(V, scale(n, 3))));
    ctx.stroke();
    ctx.restore();

    // Ruler arms (mm ticks) — baseline arm and measuring arm.
    const armDir = ccw(s.base, s.phi);
    for (const [dir, len, color] of [
      [u, s.arm1, rc.theme.accent],
      [armDir, s.arm2, rc.theme.accent2],
    ] as [Vec, number, string][]) {
      drawMarkerLine(rc, V, add(V, scale(dir, len)), add(V, scale(dir, len)), color);
      const nn: Vec = [dir[1], -dir[0]];
      ctx.save();
      drawScale(rc, {
        zero: V,
        dir,
        normal: nn,
        from: 0,
        to: len,
        kind: 'mm',
        ink: color,
        textUp: nn,
        tickScale: 0.5,
        labelSize: 0,
      });
      ctx.restore();
    }

    // Angle arc and value.
    const r0 = Math.min(s.R * 0.38, 12);
    ctx.save();
    ctx.strokeStyle = rc.theme.accent2;
    ctx.lineWidth = 2 * rc.dpr;
    ctx.beginPath();
    for (let k = 0; k <= 40; k++) {
      const p = rc.mmToPx(add(V, scale(ccw(s.base, (k / 40) * s.phi), r0)));
      if (k === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
    ctx.restore();
    if (!rc.inLoupe) {
      const [r] = this.readouts();
      const mid = ccw(s.base, s.phi / 2);
      drawTag(
        rc,
        `${r.label} ${fmtAngle(r.value, r.uncertainty)}`,
        add(V, scale(mid, r0 + 5)),
        n,
        rc.theme.ink,
        rc.theme.bg,
      );
      drawKnob(rc, this.baseEnd(), rc.theme.accent, {
        active: rc.activeHandleId === 'base',
        glyph: 'rotate',
      });
      drawKnob(rc, this.armEnd(), rc.theme.accent2, { active: rc.activeHandleId === 'arm', glyph: 'rotate' });
      drawKnob(rc, V, '#334155', { active: rc.activeHandleId === 'vtx' });
    }
  }

  private renderTwoLine(rc: RenderContext): void {
    const { ctx } = rc;
    const s = this.s;
    const b = this.env.bounds();
    const lines: [Vec, Vec, string][] = [
      [s.pts[0], s.pts[1], rc.theme.accent],
      [s.pts[2], s.pts[3], rc.theme.accent2],
    ];
    for (const [a, c, color] of lines) {
      const dir = sub(c, a);
      const l = Math.hypot(dir[0], dir[1]) || 1;
      const ud: Vec = [dir[0] / l, dir[1] / l];
      const clip = clipLineToRect(a, ud, b);
      if (clip) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([4 * rc.dpr, 3 * rc.dpr]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        line(ctx, rc.mmToPx(add(a, scale(ud, clip[0]))), rc.mmToPx(add(a, scale(ud, clip[1]))));
        ctx.stroke();
        ctx.restore();
      }
      drawMarkerLine(rc, a, c, c, color);
    }
    const [r] = this.readouts();
    const X = lineIntersection(s.pts[0], sub(s.pts[1], s.pts[0]), s.pts[2], sub(s.pts[3], s.pts[2]));
    if (!rc.inLoupe) {
      const tagAt: Vec =
        X && inRect(X, b)
          ? add(X, [0, -6])
          : scale(add(add(s.pts[0], s.pts[1]), add(s.pts[2], s.pts[3])), 0.25);
      drawTag(
        rc,
        `${r.label} ${fmtAngle(r.value, r.uncertainty)}`,
        tagAt,
        [0, -1],
        rc.theme.ink,
        rc.theme.bg,
      );
      s.pts.forEach((p, i) =>
        drawKnob(rc, p, i < 2 ? rc.theme.accent : rc.theme.accent2, {
          active: rc.activeHandleId === `p${i}`,
        }),
      );
    }
  }
}

export function isProtractorState(x: unknown): x is ProtractorState {
  const o = x as ProtractorState;
  return !!o && o.tool === 'protractor' && Array.isArray(o.vertex);
}
