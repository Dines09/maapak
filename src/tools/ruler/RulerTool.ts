// Ruler (§6.1): a thin scale with two markers. Both ends can be dragged anywhere (length and direction),
// the markers are solid full-height lines, and the leapfrog chain covers parts longer than the screen.
import type { Vec } from '../../core/types';
import {
  add,
  dirOf,
  dist,
  dot,
  fitShift,
  inRect,
  normAngle,
  projectT,
  rad2deg,
  rayExitT,
  rotateAbout,
  scale,
  snapAngle,
  sub,
  type RectMm,
} from '../../core/geometry';
import { combineRss } from '../../core/uncertainty';
import i18n from '../../i18n';
import type { Handle, Readout, RenderContext, ToolAction, ToolInstance } from '../../render/types';
import { SKINS, skinInk } from '../../render/skins';
import { drawKnob, drawMarkerLine, drawScale, drawText, polygonPx, type ScaleKind } from '../../render/draw';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../base';

export type RulerKind = 'ruler' | 'leapfrog';

export interface RulerState {
  v: 1;
  id: string;
  tool: RulerKind;
  n: number;
  placed: boolean;
  slot: number;
  origin: Vec;
  angle: number;
  length: number;
  width: number;
  zero: number;
  flip: boolean;
  a: number;
  b: number;
  segments: number[];
  segU: number[];
}

/** Thin scale band (mm). */
export const STRIP = 7;
/** Marker knobs sit just beyond the band, away from the edge being aligned. */
export const KNOB_OFFSET = 4.5;
export const TICK_SCALE = 0.68;
const MIN_LEN = 15;
const END = 3; // end-handle inset from the scale ends

export function defaultRulerState(tool: RulerKind, n = 1, slot = 0): RulerState {
  return {
    v: 1,
    id: newId(tool),
    tool,
    n,
    placed: false,
    slot,
    origin: [0, 0],
    angle: 0,
    length: 60,
    width: STRIP,
    zero: 0,
    flip: false,
    a: 10,
    b: 40,
    segments: [],
    segU: [],
  };
}

interface DragCtx {
  id: string;
  p0: Vec;
  s0: RulerState;
  c0: Vec;
  snapped: number | null;
}

export class RulerTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool: RulerKind;
  s: RulerState;
  private drag: DragCtx | null = null;
  private lastMarker: 'a' | 'b' = 'b';

  constructor(state: RulerState) {
    super();
    this.s = structuredClone({ ...state, width: STRIP });
    this.id = state.id;
    this.tool = state.tool;
  }

  get label(): string {
    return `L${this.s.n}`;
  }
  set label(v: string) {
    const m = /(\d+)$/.exec(v);
    if (m) this.s.n = Number(m[1]);
  }

  // ---------- geometry ----------

  u(st = this.s): Vec {
    return dirOf(st.angle);
  }
  /** Normal from the measuring edge into the band. */
  nrm(st = this.s): Vec {
    const u = this.u(st);
    return [u[1], -u[0]];
  }
  P(t: number, st = this.s): Vec {
    return add(st.origin, scale(dirOf(st.angle), t));
  }
  Q(t: number, off: number, st = this.s): Vec {
    return add(this.P(t, st), scale(this.nrm(st), off));
  }
  center(): Vec {
    return this.Q(this.s.length / 2, STRIP / 2);
  }
  /** Knob row on the band side if there is room, else on the edge side. */
  knobOff(): number {
    const b = this.env.bounds();
    const up = STRIP + KNOB_OFFSET;
    return inRect(this.Q(this.s.length / 2, up + 2), b) ? up : -KNOB_OFFSET;
  }

  outline(): Vec[] {
    const L = this.s.length;
    return [this.Q(0, 0), this.Q(L, 0), this.Q(L, STRIP), this.Q(0, STRIP)];
  }

  angle(): number {
    return this.s.angle;
  }

  snapTargets(): Vec[] {
    const L = this.s.length;
    return [this.P(0), this.P(L), this.P(this.s.a), this.P(this.s.b)];
  }

  focusOf(handleId: string): Vec | null {
    if (handleId === 'a') return this.P(this.s.a);
    if (handleId === 'b') return this.P(this.s.b);
    if (handleId === 'end') return this.P(this.s.length);
    if (handleId === 'start') return this.P(0);
    return null;
  }

  // ---------- placement & constraints ----------

  attach(env: Parameters<BaseTool['attach']>[0]): void {
    super.attach(env);
    if (!this.s.placed) this.place(env.placeBounds());
  }

  private place(b: RectMm): void {
    const s = this.s;
    s.angle = 0;
    s.length = Math.max(MIN_LEN, b.w - 4);
    const y = b.y + STRIP + KNOB_OFFSET + 6 + Math.min(b.h * 0.25, 30) + s.slot * 26;
    s.origin = [b.x + 2, Math.min(b.y + b.h - 6, y)];
    if (s.tool === 'leapfrog') {
      s.zero = 4;
      s.a = 4;
      s.b = s.length - 4;
    } else {
      s.zero = 0;
      s.a = Math.min(10, s.length);
      s.b = Math.min(40, s.length);
    }
    s.placed = true;
  }

  fit(b: RectMm): void {
    for (let i = 0; i < 20; i++) {
      this.s.origin = add(this.s.origin, fitShift(this.outline(), b));
      if (this.outline().every((p) => inRect(p, b, 0.01)) || this.s.length <= MIN_LEN) return;
      this.setLength(Math.max(MIN_LEN, this.s.length * 0.92));
    }
  }

  private setLength(L: number): void {
    const s = this.s;
    s.length = L;
    s.a = clamp(s.a, 0, L);
    s.b = clamp(s.b, 0, L);
    s.zero = clamp(s.zero, 0, L);
  }

  rotateBy(deg: number, pivot: Vec): void {
    this.s.origin = rotateAbout(this.s.origin, pivot, deg);
    this.s.angle = normAngle(this.s.angle + deg);
  }

  // ---------- hit testing & dragging ----------

  hitTest(p: Vec, tol: number): Handle | null {
    const s = this.s;
    const ko = this.knobOff();
    const cands: [string, Vec, Handle['kind']][] = [
      ['a', this.Q(s.a, ko), 'edge'],
      ['b', this.Q(s.b, ko), 'edge'],
      ['start', this.Q(END, STRIP / 2), 'point'],
      ['end', this.Q(s.length - END, STRIP / 2), 'point'],
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
    const t = projectT(p, s.origin, this.u());
    const off = dot(sub(p, s.origin), this.nrm());
    if (t >= 0 && t <= s.length && off >= -1 && off <= STRIP + 1)
      return { id: 'body', kind: 'body', posMm: p };
    return null;
  }

  onDragStart(h: Handle, p: Vec): void {
    if (h.id === 'a' || h.id === 'b') this.lastMarker = h.id;
    this.drag = { id: h.id, p0: p, s0: structuredClone(this.s), c0: this.center(), snapped: null };
  }

  onDragMove(h: Handle, p: Vec, _precision = false): void {
    const d = this.drag;
    if (!d) return;
    const s = this.s;
    const s0 = d.s0;
    const delta = sub(p, d.p0);
    switch (h.id) {
      case 'a':
      case 'b': {
        const t = this.snapT(clamp(s0[h.id] + dot(delta, this.u(s0)), 0, s.length));
        s[h.id] = t;
        if (s.tool === 'leapfrog' && h.id === 'a') s.zero = t;
        break;
      }
      case 'start':
      case 'end':
        this.moveEnd(h.id, delta);
        break;
      default: {
        s.origin = add(s0.origin, delta);
        this.snapBody();
      }
    }
  }

  /** Drag either end anywhere: length and direction change; markers stay over the same point of the part. */
  private moveEnd(which: 'start' | 'end', delta: Vec): void {
    const s = this.s;
    const s0 = this.drag!.s0;
    const b = this.env.bounds();
    const A0 = this.P(0, s0);
    const B0 = this.P(s0.length, s0);
    const fixed = which === 'start' ? B0 : A0;
    let moving = add(which === 'start' ? A0 : B0, delta);
    moving = [clamp(moving[0], b.x, b.x + b.w), clamp(moving[1], b.y, b.y + b.h)];
    const v = which === 'start' ? sub(fixed, moving) : sub(moving, fixed);
    const L = Math.max(MIN_LEN, Math.hypot(v[0], v[1]));
    const ang = normAngle(this.snapAngleTo(rad2deg(Math.atan2(v[1], v[0]))));
    s.angle = ang;
    s.length = L;
    s.origin = which === 'start' ? sub(fixed, scale(dirOf(ang), L)) : fixed;
    for (const k of ['a', 'b', 'zero'] as const) {
      s[k] = clamp(projectT(this.P(s0[k], s0), s.origin, this.u()), 0, L);
    }
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  wheel(stepMm: number): void {
    const k = this.lastMarker;
    this.s[k] = clamp(this.s[k] + stepMm, 0, this.s.length);
    if (this.s.tool === 'leapfrog' && k === 'a') this.s.zero = this.s.a;
  }

  private snapT(t: number): number {
    const s = this.s;
    const d = this.drag;
    let target: number | null = null;
    const step = this.env.tickSnapMm();
    if (step > 0) {
      const v = s.flip ? s.zero - t : t - s.zero;
      const vs = Math.round(v / step) * step;
      const ts = s.flip ? s.zero - vs : s.zero + vs;
      if (Math.abs(ts - t) <= Math.min(step * 0.3, 0.35)) target = ts;
    }
    if (target === null) {
      const u = this.u();
      const n = this.nrm();
      for (const q of this.env.snapPoints(this.id)) {
        const tq = projectT(q, s.origin, u);
        const off = Math.abs(dot(sub(q, s.origin), n));
        if (off < 80 && Math.abs(tq - t) <= 0.8 && tq >= 0 && tq <= s.length) {
          target = tq;
          break;
        }
      }
    }
    if (target !== null && d && d.snapped !== target) this.snapHaptic();
    if (d) d.snapped = target;
    return target ?? t;
  }

  private snapAngleTo(angle: number): number {
    if (!this.env.angleSnap()) return angle;
    const d = this.drag;
    let target: number | null = null;
    for (const o of this.env.otherAngles(this.id)) {
      for (const k of [0, 90, 180, -90]) {
        const cand = normAngle(o + k);
        if (Math.abs(normAngle(angle - cand)) <= 1.5) target = cand;
      }
    }
    if (target === null) {
      const [a, ok] = snapAngle(angle, 15, 2);
      if (ok) target = a;
    }
    if (target !== null && d && d.snapped !== target) this.snapHaptic();
    if (d) d.snapped = target;
    return target ?? angle;
  }

  private snapBody(): void {
    const pts = this.env.snapPoints(this.id);
    if (!pts.length) return;
    for (const m of [this.P(0), this.P(this.s.length)]) {
      for (const q of pts) {
        if (dist(m, q) <= 1.2) {
          this.s.origin = add(this.s.origin, sub(q, m));
          return;
        }
      }
    }
  }

  // ---------- handle menu ----------

  setZeroAt(handleId: string): boolean {
    if (handleId !== 'a' && handleId !== 'b') return false;
    this.s.zero = this.s[handleId];
    return true;
  }

  setExactValue(handleId: string, valueMm: number): boolean {
    const s = this.s;
    if (!(valueMm >= 0)) return false;
    if (handleId === 'b' || handleId === 'end') {
      const nb = s.a + (s.b >= s.a ? 1 : -1) * valueMm;
      if (nb < 0 || nb > s.length) return false;
      s.b = nb;
      return true;
    }
    if (handleId === 'a') {
      const na = s.b + (s.a >= s.b ? 1 : -1) * valueMm;
      if (na < 0 || na > s.length) return false;
      s.a = na;
      if (s.tool === 'leapfrog') s.zero = na;
      return true;
    }
    return false;
  }

  // ---------- actions ----------

  actions(): ToolAction[] {
    const s = this.s;
    const list: ToolAction[] = [
      { id: 'rot90', labelKey: 'action.rotate90', run: () => this.rotateBy(90, this.center()) },
    ];
    if (s.tool !== 'leapfrog') {
      list.push({
        id: 'flip',
        labelKey: 'action.flip',
        active: s.flip,
        run: () => {
          s.flip = !s.flip;
          s.zero = s.length - s.zero;
        },
      });
      list.push({ id: 'zeroA', labelKey: 'action.zeroAtA', run: () => this.setZeroAt('a') });
    }
    return list;
  }

  /** Leapfrog: keep the current span as a finished segment. */
  mark(): void {
    const L = Math.abs(this.s.b - this.s.a);
    if (L <= 0) return;
    this.s.segments.push(L);
    this.s.segU.push(this.env.uncertainty(L, this.u(), 2));
  }

  undoMark(): void {
    this.s.segments.pop();
    this.s.segU.pop();
  }

  resetChain(): void {
    this.s.segments = [];
    this.s.segU = [];
  }

  // ---------- readouts ----------

  readouts(): Readout[] {
    const s = this.s;
    const L = Math.abs(s.b - s.a);
    const U = this.env.uncertainty(L, this.u(), 2);
    if (s.tool !== 'leapfrog') {
      return [
        {
          label: `L${s.n}`,
          kind: 'length',
          value: L,
          uncertainty: U,
          primary: true,
          unit: 'length',
          nameKey: 'readout.length',
        },
      ];
    }
    const total = s.segments.reduce((a, b) => a + b, 0) + L;
    return [
      {
        label: `L${s.n}`,
        kind: 'length',
        value: total,
        uncertainty: combineRss([...s.segU, U]),
        primary: true,
        unit: 'length',
        nameKey: 'readout.total',
      },
      {
        label: `#${s.segments.length + 1}`,
        kind: 'length',
        value: L,
        uncertainty: U,
        unit: 'length',
        nameKey: 'readout.segment',
      },
      {
        label: 'N',
        kind: 'length',
        value: s.segments.length + 1,
        uncertainty: 0,
        unit: 'count',
        nameKey: 'readout.segments',
      },
    ];
  }

  toMeasurements(): ToolMeasurement[] {
    return this.readouts()
      .filter((r) => r.primary)
      .map((r) => ({
        tool: this.tool,
        kind: r.kind,
        label: r.label,
        value: r.value,
        uncertainty: r.uncertainty,
        toolState: this.serialize(),
      }));
  }

  serialize(): RulerState {
    return structuredClone(this.s);
  }

  // ---------- rendering ----------

  render(rc: RenderContext): void {
    const { ctx } = rc;
    const s = this.s;
    const skin = SKINS[rc.theme.skin];
    const L = s.length;
    const u = this.u();
    const n = this.nrm();
    const band = [this.Q(0, 0), this.Q(L, 0), this.Q(L, STRIP), this.Q(0, STRIP)].map((p) => rc.mmToPx(p));

    // Thin translucent band so ticks stay readable on any background.
    ctx.save();
    polygonPx(ctx, band);
    ctx.fillStyle = skin.body;
    ctx.globalAlpha = skin.alpha < 1 ? skin.alpha : 0.82;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = rc.selected ? 1.5 * rc.dpr : 1;
    ctx.strokeStyle = rc.selected ? rc.theme.accent : 'rgba(0,0,0,0.35)';
    ctx.stroke();
    ctx.restore();

    const ink = skinInk(skin, rc.theme.bg);
    const kind: ScaleKind = rc.unit === 'mm' ? 'mm' : rc.unit === 'cm' ? 'cm' : 'inch';
    const v0 = s.flip ? s.zero : -s.zero;
    const v1 = s.flip ? s.zero - L : L - s.zero;
    ctx.save();
    polygonPx(ctx, band);
    ctx.clip();
    drawScale(rc, {
      zero: this.P(s.zero),
      dir: s.flip ? scale(u, -1) : u,
      normal: n,
      from: Math.min(v0, v1),
      to: Math.max(v0, v1),
      kind,
      ink,
      textUp: n,
      inchDen: rc.fractionDen,
      tickScale: TICK_SCALE,
      labelSize: 2,
    });
    ctx.restore();

    // Zero indicator.
    const z0 = rc.mmToPx(this.P(s.zero));
    const z1 = rc.mmToPx(this.Q(s.zero - 1, -1.6));
    const z2 = rc.mmToPx(this.Q(s.zero + 1, -1.6));
    ctx.save();
    ctx.fillStyle = rc.theme.accent;
    ctx.beginPath();
    ctx.moveTo(z0[0], z0[1]);
    ctx.lineTo(z1[0], z1[1]);
    ctx.lineTo(z2[0], z2[1]);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Solid marker lines across the whole usable area (§7.8 sighting lines).
    const b = this.env.bounds();
    const ko = this.knobOff();
    const marks: ['a' | 'b', string][] = [
      ['a', rc.theme.accent],
      ['b', rc.theme.accent2],
    ];
    for (const [k, color] of marks) {
      const t = s[k];
      const base = this.P(t);
      const down = rayExitT(base, scale(n, -1), b);
      const up = rayExitT(base, n, b);
      drawMarkerLine(rc, this.Q(t, -down), base, this.Q(t, up), color);
      if (!rc.inLoupe) drawKnob(rc, this.Q(t, ko), color, { active: rc.activeHandleId === k });
    }

    if (!rc.inLoupe) {
      if (s.tool === 'leapfrog') {
        const tt = i18n.t.bind(i18n);
        const off = ko > 0 ? ko + 4.2 : ko - 4.2;
        drawText(rc, tt('leap.startHere'), this.Q(s.a, off), n, {
          sizeMm: 3.4,
          color: rc.theme.ink,
          halo: rc.theme.bg,
          weight: 700,
        });
        drawText(rc, tt('leap.markHere'), this.Q(s.b, off), n, {
          sizeMm: 3.4,
          color: rc.theme.ink,
          halo: rc.theme.bg,
          weight: 700,
        });
      }
      if (rc.selected) {
        drawKnob(rc, this.Q(END, STRIP / 2), '#334155', {
          glyph: 'extend',
          active: rc.activeHandleId === 'start',
        });
        drawKnob(rc, this.Q(L - END, STRIP / 2), '#334155', {
          glyph: 'extend',
          active: rc.activeHandleId === 'end',
        });
      }
    }
  }
}

export function isRulerState(x: unknown): x is RulerState {
  const o = x as RulerState;
  return (
    !!o &&
    o.v === 1 &&
    (o.tool === 'ruler' || o.tool === 'leapfrog') &&
    Array.isArray(o.origin) &&
    typeof o.length === 'number'
  );
}
