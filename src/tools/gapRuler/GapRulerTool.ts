// Parallel / Gap rulers (§6.1 B): two parallel rulers, each dragged perpendicular to its length. The gap
// between the measuring edges is the width; two cursor markers give the length. One setup → L × W.
import type { Vec } from '../../core/types';
import {
  add,
  clipLineToRect,
  dirOf,
  dist,
  dot,
  inRect,
  normAngle,
  projectT,
  rad2deg,
  rotateAbout,
  scale,
  snapAngle,
  sub,
  type RectMm,
} from '../../core/geometry';
import type { Handle, Readout, RenderContext, ToolAction, ToolInstance } from '../../render/types';
import { SKINS, skinInk } from '../../render/skins';
import {
  drawKnob,
  drawMarkerLine,
  drawScale,
  drawTag,
  polygonPx,
  line,
  type ScaleKind,
} from '../../render/draw';
import { fmtLength } from '../../render/format';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../base';
import { ghostFrom, linear, rectPts } from '../drawing';
import type { DrawingEntities, GhostShape } from '../../render/types';

import { TICK_SCALE } from '../ruler/RulerTool';

const STRIP = 7;
const KNOB_OFFSET = 4.5;

export interface GapState {
  v: 1;
  id: string;
  tool: 'gapRuler';
  n: number;
  placed: boolean;
  c: Vec;
  angle: number;
  oA: number;
  oB: number;
  width: number;
  a: number;
  b: number;
  zero: number;
  primary: 'W' | 'L';
}

const CAP = 8;
const MIN_LINE = 25;

export function defaultGapState(n = 1): GapState {
  return {
    v: 1,
    id: newId('gap'),
    tool: 'gapRuler',
    n,
    placed: false,
    c: [0, 0],
    angle: 0,
    oA: 15,
    oB: -15,
    width: STRIP,
    a: -20,
    b: 20,
    zero: -30,
    primary: 'W',
  };
}

interface DragCtx {
  id: string;
  p0: Vec;
  s0: GapState;
  ang0: number;
  snapped: number | null;
}

export class GapRulerTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool = 'gapRuler' as const;
  s: GapState;
  private drag: DragCtx | null = null;
  private lastId: 'rA' | 'rB' | 'a' | 'b' = 'rA';

  constructor(state: GapState) {
    super();
    this.s = structuredClone({ ...state, width: STRIP });
    this.id = state.id;
  }

  get label(): string {
    return `W${this.s.n}`;
  }
  set label(v: string) {
    const m = /(\d+)$/.exec(v);
    if (m) this.s.n = Number(m[1]);
  }

  u(st = this.s): Vec {
    return dirOf(st.angle);
  }
  nrm(st = this.s): Vec {
    const u = this.u(st);
    return [u[1], -u[0]];
  }
  R(t: number, off: number, st = this.s): Vec {
    return add(add(st.c, scale(this.u(st), t)), scale(this.nrm(st), off));
  }
  angle(): number {
    return this.s.angle;
  }
  private knobOff(st = this.s): number {
    return st.oB - st.width - KNOB_OFFSET;
  }
  private offsets(st = this.s): number[] {
    return [st.oA + st.width, st.oB - st.width - KNOB_OFFSET - 2.5];
  }

  attach(env: Parameters<BaseTool['attach']>[0]): void {
    super.attach(env);
    if (!this.s.placed) {
      const b = env.placeBounds();
      const s = this.s;
      s.angle = 0;
      const top = b.y + s.width + 4;
      const bottom = Math.min(b.y + b.h - (s.width + KNOB_OFFSET + 6), top + 80);
      s.c = [b.x + b.w / 2, (top + bottom) / 2];
      const half = Math.max(10, (bottom - top) / 2);
      s.oA = half;
      s.oB = -half;
      s.zero = -b.w / 2 + 2;
      s.a = -b.w / 4;
      s.b = b.w / 4;
      s.placed = true;
    }
  }

  /** Put the two measuring edges where two fingers were held (horizontal or vertical pair). */
  placeAt(p1: Vec, p2: Vec, b: RectMm): void {
    const s = this.s;
    const vertical = Math.abs(p1[0] - p2[0]) > Math.abs(p1[1] - p2[1]);
    s.angle = vertical ? 90 : 0;
    const mid: Vec = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    s.c = vertical ? [mid[0], b.y + b.h / 2] : [b.x + b.w / 2, mid[1]];
    // n points up for angle 0 and right for angle 90.
    const off = (p: Vec) => (vertical ? p[0] - s.c[0] : s.c[1] - p[1]);
    s.oA = Math.max(off(p1), off(p2));
    s.oB = Math.min(off(p1), off(p2));
    const tr = this.range(0, b) ?? [-20, 20];
    s.zero = tr[0] + 2;
    s.a = tr[0] + (tr[1] - tr[0]) * 0.25;
    s.b = tr[0] + (tr[1] - tr[0]) * 0.75;
    s.placed = true;
  }

  /** Visible t-range of a line at offset `off`. */
  private range(off: number, b: RectMm, st = this.s): [number, number] | null {
    return clipLineToRect(add(st.c, scale(this.nrm(st), off)), this.u(st), b);
  }

  private valid(st: GapState, b: RectMm): boolean {
    if (!inRect(st.c, b) || st.oA < st.oB) return false;
    return this.offsets(st).every((o) => {
      const r = this.range(o, b, st);
      return !!r && r[1] - r[0] >= MIN_LINE;
    });
  }

  outline(): Vec[] {
    const b = this.env.bounds();
    const r = this.range(0, b) ?? [-10, 10];
    return [this.R(r[0], this.s.oA + this.s.width), this.R(r[1], this.knobOff())];
  }

  fit(b: RectMm): void {
    if (this.valid(this.s, b)) return;
    // Pull the centre inside and shrink the gap until valid.
    const s = this.s;
    s.c = [clamp(s.c[0], b.x + 1, b.x + b.w - 1), clamp(s.c[1], b.y + 1, b.y + b.h - 1)];
    for (let i = 0; i < 40 && !this.valid(s, b); i++) {
      s.oA = Math.max(0.5, s.oA * 0.9);
      s.oB = Math.min(-0.5, s.oB * 0.9);
    }
    const tr = this.range(0, b);
    if (tr) {
      s.a = clamp(s.a, tr[0], tr[1]);
      s.b = clamp(s.b, tr[0], tr[1]);
    }
  }

  rotateBy(deg: number, pivot: Vec): void {
    this.s.c = rotateAbout(this.s.c, pivot, deg);
    this.s.angle = normAngle(this.s.angle + deg);
  }

  snapTargets(): Vec[] {
    return [
      this.R(this.s.a, this.s.oA),
      this.R(this.s.b, this.s.oA),
      this.R(this.s.a, this.s.oB),
      this.R(this.s.b, this.s.oB),
    ];
  }

  focusOf(id: string): Vec | null {
    const s = this.s;
    const mid = (s.oA + s.oB) / 2;
    if (id === 'a' || id === 'b') return this.R(s[id], mid);
    if (id === 'rA' || id === 'rB') {
      const t = this.drag ? projectT(this.drag.p0, s.c, this.u()) : 0;
      return this.R(t, id === 'rA' ? s.oA : s.oB);
    }
    return null;
  }

  hitTest(p: Vec, tol: number): Handle | null {
    const s = this.s;
    const ko = this.knobOff();
    const da = dist(p, this.R(s.a, ko));
    const db = dist(p, this.R(s.b, ko));
    if (Math.min(da, db) <= tol) {
      const id = da <= db ? 'a' : 'b';
      return { id, kind: 'edge', posMm: this.R(s[id], ko) };
    }
    const t = projectT(p, s.c, this.u());
    const off = dot(sub(p, s.c), this.nrm());
    const b = this.env.bounds();
    const ra = this.range(s.oA, b);
    if (off >= s.oA && off <= s.oA + s.width) {
      if (ra && t <= ra[0] + CAP)
        return { id: 'rot', kind: 'rotate', posMm: this.R(ra[0] + CAP / 2, s.oA + s.width / 2) };
      return { id: 'rA', kind: 'edge', posMm: p };
    }
    if (off <= s.oB && off >= s.oB - s.width) return { id: 'rB', kind: 'edge', posMm: p };
    return null;
  }

  onDragStart(h: Handle, p: Vec): void {
    if (h.id === 'rA' || h.id === 'rB' || h.id === 'a' || h.id === 'b') this.lastId = h.id;
    this.drag = {
      id: h.id,
      p0: p,
      s0: structuredClone(this.s),
      ang0: rad2deg(Math.atan2(p[1] - this.s.c[1], p[0] - this.s.c[0])),
      snapped: null,
    };
  }

  onDragMove(h: Handle, p: Vec, _precision = false): void {
    const d = this.drag;
    if (!d) return;
    const s = this.s;
    const s0 = d.s0;
    const delta = sub(p, d.p0);
    const b = this.env.bounds();
    switch (h.id) {
      case 'rA':
      case 'rB': {
        const key = h.id === 'rA' ? 'oA' : 'oB';
        const want = s0[key] + dot(delta, this.nrm(s0));
        const lo = key === 'oA' ? s.oB : -Infinity;
        const hi = key === 'oA' ? Infinity : s.oA;
        const target = clamp(want, lo, hi);
        const trial = { ...s, [key]: target };
        if (this.valid(trial, b)) {
          s[key] = target;
        } else {
          // Binary search the furthest valid position towards the target.
          let good = s[key];
          let bad = target;
          for (let i = 0; i < 12; i++) {
            const mid = (good + bad) / 2;
            if (this.valid({ ...s, [key]: mid }, b)) good = mid;
            else bad = mid;
          }
          s[key] = good;
        }
        s.primary = 'W';
        break;
      }
      case 'a':
      case 'b': {
        const tr = this.range(0, b) ?? [-50, 50];
        let t = clamp(s0[h.id] + dot(delta, this.u(s0)), tr[0], tr[1]);
        const step = this.env.tickSnapMm();
        if (step > 0) {
          const ts = s.zero + Math.round((t - s.zero) / step) * step;
          if (Math.abs(ts - t) <= Math.min(step * 0.3, 0.35)) {
            if (d.snapped !== ts) this.snapHaptic();
            d.snapped = ts;
            t = ts;
          } else d.snapped = null;
        }
        s[h.id] = t;
        s.primary = 'L';
        break;
      }
      case 'rot': {
        const a = rad2deg(Math.atan2(p[1] - s0.c[1], p[0] - s0.c[0]));
        let target = normAngle(s0.angle + normAngle(a - d.ang0));
        if (this.env.angleSnap()) {
          const [sa, ok] = snapAngle(target, 15, 2);
          if (ok) {
            if (d.snapped !== sa) this.snapHaptic();
            d.snapped = sa;
            target = normAngle(sa);
          } else d.snapped = null;
        }
        s.angle = target;
        break;
      }
    }
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  wheel(stepMm: number): void {
    const s = this.s;
    const b = this.env.bounds();
    if (this.lastId === 'rA' || this.lastId === 'rB') {
      const key = this.lastId === 'rA' ? 'oA' : 'oB';
      const next = { ...s, [key]: s[key] + (key === 'oA' ? stepMm : -stepMm) };
      if (next.oA >= next.oB && this.valid(next, b)) s[key] = next[key];
      s.primary = 'W';
    } else {
      s[this.lastId] += stepMm;
      s.primary = 'L';
    }
  }

  setExactValue(handleId: string, valueMm: number): boolean {
    const s = this.s;
    if (!(valueMm >= 0)) return false;
    if (handleId === 'rA') {
      s.oA = s.oB + valueMm;
      return true;
    }
    if (handleId === 'rB') {
      s.oB = s.oA - valueMm;
      return true;
    }
    if (handleId === 'a' || handleId === 'b') {
      const other = handleId === 'a' ? s.b : s.a;
      const dir = s[handleId] >= other ? 1 : -1;
      s[handleId] = other + dir * valueMm;
      return true;
    }
    return false;
  }

  setZeroAt(handleId: string): boolean {
    if (handleId !== 'a' && handleId !== 'b') return false;
    this.s.zero = this.s[handleId];
    return true;
  }

  actions(): ToolAction[] {
    return [
      {
        id: 'rot90',
        labelKey: 'action.rotate90',
        run: () => {
          const b = this.env.bounds();
          this.rotateBy(90, this.s.c);
          const tr = this.range(0, b);
          if (tr) this.s.zero = tr[0] + 2;
        },
      },
      { id: 'zeroA', labelKey: 'action.zeroAtA', run: () => this.setZeroAt('a') },
    ];
  }

  readouts(): Readout[] {
    const s = this.s;
    const W = Math.max(0, s.oA - s.oB);
    const L = Math.abs(s.b - s.a);
    const UW = this.env.uncertainty(W, this.nrm(), 2);
    const UL = this.env.uncertainty(L, this.u(), 2);
    const area = W * L;
    const UA = Math.hypot(W * UL, L * UW);
    return [
      {
        label: `W${s.n}`,
        kind: 'width',
        value: W,
        uncertainty: UW,
        primary: s.primary === 'W',
        unit: 'length',
        nameKey: 'readout.gap',
      },
      {
        label: `L${s.n}`,
        kind: 'length',
        value: L,
        uncertainty: UL,
        primary: s.primary === 'L',
        unit: 'length',
        nameKey: 'readout.length',
      },
      {
        label: `AR${s.n}`,
        kind: 'area',
        value: area,
        uncertainty: UA,
        unit: 'area',
        nameKey: 'readout.area',
      },
    ];
  }

  toMeasurements(): ToolMeasurement[] {
    return this.readouts()
      .filter((r) => r.kind !== 'area')
      .map((r) => ({
        tool: this.tool,
        kind: r.kind,
        label: r.label,
        value: r.value,
        uncertainty: r.uncertainty,
        toolState: this.serialize(),
      }));
  }

  toDrawing(): DrawingEntities {
    const s = this.s;
    const W = Math.max(0, s.oA - s.oB);
    const L = Math.abs(s.b - s.a);
    return {
      views: {
        top: {
          outline: [{ type: 'polyline', points: rectPts(L, W), closed: true }],
          dims: [
            linear('length', `L${s.n}`, L, 0, [-L / 2, W / 2], [L / 2, W / 2], -8),
            linear('width', `W${s.n}`, W, 0, [L / 2, W / 2], [L / 2, -W / 2], -8),
          ],
        },
      },
    };
  }

  toGhost(): GhostShape {
    const s = this.s;
    return ghostFrom([
      { kind: 'polyline', points: rectPts(Math.abs(s.b - s.a), Math.max(1, s.oA - s.oB)), closed: true },
    ]);
  }

  serialize(): GapState {
    return structuredClone(this.s);
  }

  render(rc: RenderContext): void {
    const { ctx } = rc;
    const s = this.s;
    const b = this.env.bounds();
    const skin = SKINS[rc.theme.skin];
    const ink = skinInk(skin, rc.theme.bg);
    const u = this.u();
    const n = this.nrm();
    const kind: ScaleKind = rc.unit === 'mm' ? 'mm' : rc.unit === 'cm' ? 'cm' : 'inch';
    const rulers: [number, number][] = [
      [s.oA, 1],
      [s.oB, -1],
    ];
    for (const [off, side] of rulers) {
      const r = this.range(off, b);
      if (!r) continue;
      const body = [
        this.R(r[0], off),
        this.R(r[1], off),
        this.R(r[1], off + side * s.width),
        this.R(r[0], off + side * s.width),
      ].map((p) => rc.mmToPx(p));
      ctx.save();
      polygonPx(ctx, body);
      if (skin.body2) {
        const g = ctx.createLinearGradient(body[0][0], body[0][1], body[3][0], body[3][1]);
        g.addColorStop(0, skin.body);
        g.addColorStop(0.5, skin.body2);
        g.addColorStop(1, skin.body);
        ctx.fillStyle = g;
      } else ctx.fillStyle = skin.body;
      ctx.globalAlpha = skin.alpha;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = rc.selected ? 2 * rc.dpr : 1;
      ctx.strokeStyle = rc.selected ? rc.theme.accent : 'rgba(0,0,0,0.45)';
      ctx.stroke();
      ctx.clip();
      drawScale(rc, {
        zero: this.R(s.zero, off),
        dir: u,
        normal: scale(n, side),
        from: r[0] - s.zero,
        to: r[1] - s.zero,
        kind,
        ink,
        textUp: n,
        inchDen: rc.fractionDen,
        tickScale: TICK_SCALE,
        labelSize: 2,
      });
      ctx.restore();
    }

    // Cursor markers spanning both rulers.
    const ko = this.knobOff();
    const marks: ['a' | 'b', string][] = [
      ['a', rc.theme.accent],
      ['b', rc.theme.accent2],
    ];
    for (const [k, color] of marks) {
      const end = this.R(s[k], s.oA + s.width);
      drawMarkerLine(rc, this.R(s[k], ko), end, end, color);
      if (!rc.inLoupe) drawKnob(rc, this.R(s[k], ko), color, { active: rc.activeHandleId === k });
    }

    // Live gap dimension line in the middle (§6.1 B).
    const [rW, rL] = this.readouts();
    const tr = this.range(0, b);
    if (tr) {
      const tDim = tr[1] - 7;
      const pa = rc.mmToPx(this.R(tDim, s.oA));
      const pb = rc.mmToPx(this.R(tDim, s.oB));
      ctx.save();
      ctx.strokeStyle = rc.theme.ink;
      ctx.fillStyle = rc.theme.ink;
      ctx.lineWidth = 1.2 * rc.dpr;
      ctx.beginPath();
      line(ctx, pa, pb);
      ctx.stroke();
      const ah = 1.6 * rc.pxPerMm;
      for (const [tip, other] of [
        [pa, pb],
        [pb, pa],
      ] as [Vec, Vec][]) {
        const dx = other[0] - tip[0];
        const dy = other[1] - tip[1];
        const l = Math.hypot(dx, dy) || 1;
        const ux = dx / l;
        const uy = dy / l;
        ctx.beginPath();
        ctx.moveTo(tip[0], tip[1]);
        ctx.lineTo(tip[0] + ux * ah - uy * ah * 0.35, tip[1] + uy * ah + ux * ah * 0.35);
        ctx.lineTo(tip[0] + ux * ah + uy * ah * 0.35, tip[1] + uy * ah - ux * ah * 0.35);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      if (!rc.inLoupe) {
        drawTag(
          rc,
          `${rW.label} ${fmtLength(rW.value, rW.uncertainty, rc.unit, rc.fractionDen)}`,
          this.R(tDim - 6, (s.oA + s.oB) / 2),
          n,
          rc.theme.ink,
          rc.theme.bg,
        );
      }
    }
    if (!rc.inLoupe) {
      if (Math.abs(s.b - s.a) > 18) {
        drawTag(
          rc,
          `${rL.label} ${fmtLength(rL.value, rL.uncertainty, rc.unit, rc.fractionDen)}`,
          this.R((s.a + s.b) / 2, ko),
          n,
          rc.theme.ink,
          rc.theme.bg,
        );
      }
      const ra = this.range(s.oA, b);
      if (rc.selected && ra)
        drawKnob(rc, this.R(ra[0] + CAP / 2, s.oA + s.width / 2), '#334155', {
          glyph: 'rotate',
          active: rc.activeHandleId === 'rot',
        });
    }
  }
}
