// Ruler (§6.1): A Classic, C Split dual-unit, D Leapfrog chain. Mode E (Free / T-square) is several
// classic rulers with parallel/perpendicular snapping.
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
import type { Handle, Readout, RenderContext, ToolAction, ToolInstance } from '../../render/types';
import { SKINS, skinInk } from '../../render/skins';
import {
  drawKnob,
  drawMarkerLine,
  drawScale,
  drawTag,
  drawText,
  polygonPx,
  type ScaleKind,
} from '../../render/draw';
import { fmtLength } from '../../render/format';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../base';

export type RulerKind = 'ruler' | 'splitRuler' | 'leapfrog';

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
  bottom: 'inch' | 'metricReversed';
}

/** mm beyond the body where marker knobs sit (handles are offset from the finger, §2.4). */
export const KNOB_OFFSET = 6.5;
const CAP = 8;
const MIN_LEN = 20;

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
    width: tool === 'splitRuler' ? 26 : 16,
    zero: 0,
    flip: false,
    a: 10,
    b: 40,
    segments: [],
    segU: [],
    bottom: 'inch',
  };
}

interface DragCtx {
  id: string;
  p0: Vec;
  s0: RulerState;
  c0: Vec;
  ang0: number;
  snapped: number | null;
}

export class RulerTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool: RulerKind;
  s: RulerState;
  private drag: DragCtx | null = null;

  constructor(state: RulerState) {
    super();
    this.s = structuredClone(state);
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

  u(): Vec {
    return dirOf(this.s.angle);
  }
  /** Normal pointing from the measuring edge into the body. */
  nrm(): Vec {
    const u = this.u();
    return [u[1], -u[0]];
  }
  P(t: number, st = this.s): Vec {
    return add(st.origin, scale(dirOf(st.angle), t));
  }
  Q(t: number, off: number): Vec {
    return add(this.P(t), scale(this.nrm(), off));
  }
  private split(): boolean {
    return this.s.tool === 'splitRuler';
  }
  private knobOff(): number {
    return this.split() ? this.s.width / 2 : this.s.width + KNOB_OFFSET;
  }
  private rowOff(): number {
    return this.split() ? this.s.width : this.s.width + KNOB_OFFSET + 2.5;
  }
  center(): Vec {
    return this.Q(this.s.length / 2, this.s.width / 2);
  }

  outline(): Vec[] {
    const L = this.s.length;
    const r = this.rowOff();
    return [this.Q(0, 0), this.Q(L, 0), this.Q(L, r), this.Q(0, r)];
  }

  angle(): number {
    return this.s.angle;
  }

  snapTargets(): Vec[] {
    const L = this.s.length;
    return [
      this.P(0),
      this.P(L),
      this.P(this.s.a),
      this.P(this.s.b),
      this.Q(0, this.s.width),
      this.Q(L, this.s.width),
    ];
  }

  focusOf(handleId: string): Vec | null {
    if (handleId === 'a') return this.P(this.s.a);
    if (handleId === 'b') return this.P(this.s.b);
    if (handleId === 'end') return this.P(this.s.length);
    if (handleId === 'rot') return this.P(0);
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
    const top = b.y + this.rowOff() + 4 + s.slot * 34;
    s.origin = [b.x + 2, Math.min(b.y + b.h - 10, top)];
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

  private maxLen(b: RectMm): number {
    const u = this.u();
    const starts = [this.Q(0, 0), this.Q(0, this.rowOff())];
    if (!starts.every((p) => inRect(p, b))) return Infinity;
    return Math.min(...starts.map((p) => rayExitT(p, u, b)));
  }

  fit(b: RectMm): void {
    const shift = fitShift(this.outline(), b);
    this.s.origin = add(this.s.origin, shift);
    if (!this.outline().every((p) => inRect(p, b, 0.01))) {
      const m = this.maxLen(b);
      if (Number.isFinite(m)) this.setLength(Math.max(MIN_LEN, Math.min(this.s.length, m)));
      this.s.origin = add(this.s.origin, fitShift(this.outline(), b));
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
    let best: Handle | null = null;
    let bestD = Infinity;
    const consider = (h: Handle, d: number) => {
      if (d <= tol && d < bestD) {
        best = h;
        bestD = d;
      }
    };
    consider(
      { id: 'a', kind: 'edge', posMm: this.Q(s.a, ko), focusMm: this.P(s.a) },
      dist(p, this.Q(s.a, ko)),
    );
    consider(
      { id: 'b', kind: 'edge', posMm: this.Q(s.b, ko), focusMm: this.P(s.b) },
      dist(p, this.Q(s.b, ko)),
    );
    if (best) return best;
    const t = projectT(p, s.origin, this.u());
    const off = dot(sub(p, s.origin), this.nrm());
    const inBody = t >= 0 && t <= s.length && off >= 0 && off <= s.width;
    if (inBody && t <= CAP) return { id: 'rot', kind: 'rotate', posMm: this.Q(CAP / 2, s.width / 2) };
    if (inBody && t >= s.length - CAP) {
      return { id: 'end', kind: 'point', posMm: this.Q(s.length - CAP / 2, s.width / 2) };
    }
    if (inBody) return { id: 'body', kind: 'body', posMm: p };
    return null;
  }

  onDragStart(h: Handle, p: Vec): void {
    const c0 = this.center();
    this.drag = {
      id: h.id,
      p0: p,
      s0: structuredClone(this.s),
      c0,
      ang0: rad2deg(Math.atan2(p[1] - c0[1], p[0] - c0[0])),
      snapped: null,
    };
  }

  onDragMove(h: Handle, p: Vec, _precision = false): void {
    const d = this.drag;
    if (!d) return;
    const s = this.s;
    const s0 = d.s0;
    const delta = sub(p, d.p0);
    const u = dirOf(s0.angle);
    switch (h.id) {
      case 'a':
      case 'b': {
        const t = this.snapT(clamp(s0[h.id] + dot(delta, u), 0, s.length));
        s[h.id] = t;
        if (s.tool === 'leapfrog' && h.id === 'a') s.zero = t;
        break;
      }
      case 'end': {
        const b = this.env.bounds();
        this.setLength(clamp(s0.length + dot(delta, u), MIN_LEN, this.maxLen(b)));
        break;
      }
      case 'rot': {
        const a = rad2deg(Math.atan2(p[1] - d.c0[1], p[0] - d.c0[0]));
        let target = normAngle(s0.angle + normAngle(a - d.ang0));
        target = this.snapAngleTo(target);
        const L = s0.length;
        const W = s0.width;
        const nu = dirOf(target);
        const nn: Vec = [nu[1], -nu[0]];
        s.angle = target;
        s.origin = sub(sub(d.c0, scale(nu, L / 2)), scale(nn, W / 2));
        break;
      }
      default: {
        s.origin = add(s0.origin, delta);
        this.snapBody();
      }
    }
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  private snapT(t: number): number {
    const s = this.s;
    const d = this.drag;
    let out = t;
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
    if (target !== null) {
      out = target;
      if (d && d.snapped !== target) this.snapHaptic();
    }
    if (d) d.snapped = target;
    return out;
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
      if (ok) target = normAngle(a);
    }
    if (target !== null && d && d.snapped !== target) this.snapHaptic();
    if (d) d.snapped = target;
    return target ?? angle;
  }

  /** T-square: snap the ruler's ends onto other rulers' edge points (§6.1 E). */
  private snapBody(): void {
    const pts = this.env.snapPoints(this.id);
    if (!pts.length) return;
    const mine = [
      this.P(0),
      this.P(this.s.length),
      this.Q(0, this.s.width),
      this.Q(this.s.length, this.s.width),
    ];
    for (const m of mine) {
      for (const q of pts) {
        if (dist(m, q) <= 1.2) {
          this.s.origin = add(this.s.origin, sub(q, m));
          if (this.drag && this.drag.snapped !== -1) this.snapHaptic();
          if (this.drag) this.drag.snapped = -1;
          return;
        }
      }
    }
    if (this.drag && this.drag.snapped === -1) this.drag.snapped = null;
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
      const dir = s.b >= s.a ? 1 : -1;
      const nb = s.a + dir * valueMm;
      if (nb < 0 || nb > s.length) return false;
      s.b = nb;
      return true;
    }
    if (handleId === 'a') {
      const dir = s.a >= s.b ? 1 : -1;
      const na = s.b + dir * valueMm;
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
    if (s.tool === 'splitRuler') {
      list.push({
        id: 'variant',
        labelKey: s.bottom === 'inch' ? 'action.bottomMetric' : 'action.bottomInch',
        run: () => {
          s.bottom = s.bottom === 'inch' ? 'metricReversed' : 'inch';
        },
      });
    }
    if (s.tool === 'leapfrog') {
      list.push({ id: 'mark', labelKey: 'action.mark', run: () => this.mark() });
      list.push({
        id: 'undoMark',
        labelKey: 'action.undoMark',
        run: () => {
          s.segments.pop();
          s.segU.pop();
        },
      });
      list.push({
        id: 'resetChain',
        labelKey: 'action.resetChain',
        run: () => {
          s.segments = [];
          s.segU = [];
        },
      });
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
    const W = s.width;
    const L = s.length;
    const u = this.u();
    const n = this.nrm();
    const body = [this.Q(0, 0), this.Q(L, 0), this.Q(L, W), this.Q(0, W)].map((p) => rc.mmToPx(p));

    // Body
    ctx.save();
    polygonPx(ctx, body);
    if (skin.body2) {
      const g = ctx.createLinearGradient(body[0][0], body[0][1], body[3][0], body[3][1]);
      g.addColorStop(0, skin.body);
      g.addColorStop(0.5, skin.body2);
      g.addColorStop(1, skin.body);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = skin.body;
    }
    ctx.globalAlpha = skin.alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (skin.brushed) {
      ctx.save();
      ctx.clip();
      ctx.lineWidth = 1;
      for (let k = 1; k < 9; k++) {
        const off = (W * k) / 9 + ((k * 7) % 3) * 0.2;
        const a = rc.mmToPx(this.Q(0, off));
        const b = rc.mmToPx(this.Q(L, off));
        ctx.strokeStyle = k % 2 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.07)';
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      ctx.restore();
    }
    polygonPx(ctx, body);
    ctx.lineWidth = rc.selected ? 2 * rc.dpr : 1;
    ctx.strokeStyle = rc.selected ? rc.theme.accent : 'rgba(0,0,0,0.45)';
    ctx.stroke();
    ctx.restore();

    const bodyBg = rc.theme.bg;
    const ink = skinInk(skin, bodyBg);
    const unitKind: ScaleKind = rc.unit === 'mm' ? 'mm' : rc.unit === 'cm' ? 'cm' : 'inch';
    const range = (zero: number, flip: boolean): [number, number] => {
      const v0 = flip ? zero : -zero;
      const v1 = flip ? zero - L : L - zero;
      return [Math.min(v0, v1), Math.max(v0, v1)];
    };

    ctx.save();
    polygonPx(ctx, body);
    ctx.clip();
    if (this.split()) {
      const [f, t] = range(s.zero, false);
      drawScale(rc, { zero: this.P(s.zero), dir: u, normal: n, from: f, to: t, kind: 'mm', ink, textUp: n });
      if (s.bottom === 'inch') {
        drawScale(rc, {
          zero: this.Q(s.zero, W),
          dir: u,
          normal: scale(n, -1),
          from: f,
          to: t,
          kind: 'inch',
          ink,
          textUp: n,
          inchDen: rc.fractionDen,
        });
      } else {
        const [f2, t2] = range(L, true);
        drawScale(rc, {
          zero: this.Q(L, W),
          dir: scale(u, -1),
          normal: scale(n, -1),
          from: f2,
          to: t2,
          kind: 'mm',
          ink,
          textUp: n,
        });
      }
    } else {
      const [f, t] = range(s.zero, s.flip);
      drawScale(rc, {
        zero: this.P(s.zero),
        dir: s.flip ? scale(u, -1) : u,
        normal: n,
        from: f,
        to: t,
        kind: unitKind,
        ink,
        textUp: n,
        inchDen: rc.fractionDen,
      });
    }
    ctx.restore();

    // Zero indicator
    const z0 = rc.mmToPx(this.P(s.zero));
    const z1 = rc.mmToPx(this.Q(s.zero - 1.2, -2));
    const z2 = rc.mmToPx(this.Q(s.zero + 1.2, -2));
    ctx.save();
    ctx.fillStyle = rc.theme.accent;
    ctx.beginPath();
    ctx.moveTo(z0[0], z0[1]);
    ctx.lineTo(z1[0], z1[1]);
    ctx.lineTo(z2[0], z2[1]);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Markers with sighting lines
    const b = this.env.bounds();
    const sight = (t: number, dir: Vec) =>
      Math.min(90, rayExitT(this.P(t), dir, { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 }));
    const markers: ['a' | 'b', string][] = [
      ['a', rc.theme.accent],
      ['b', rc.theme.accent2],
    ];
    for (const [k, color] of markers) {
      const t = s[k];
      if (this.split()) {
        const down = sight(t, scale(n, -1));
        drawMarkerLine(rc, this.Q(t, W / 2), this.Q(t, -4), this.Q(t, -down), color);
        const upStart = this.Q(t, W);
        const up = Math.min(90, rayExitT(upStart, n, b));
        drawMarkerLine(rc, this.Q(t, W / 2), this.Q(t, W + 4), this.Q(t, W + up), color);
      } else {
        const down = sight(t, scale(n, -1));
        drawMarkerLine(rc, this.Q(t, this.knobOff()), this.Q(t, -5), this.Q(t, -down), color);
      }
      if (!rc.inLoupe) drawKnob(rc, this.Q(t, this.knobOff()), color, { active: rc.activeHandleId === k });
    }

    if (!rc.inLoupe) {
      // Value tag
      const r = this.readouts()[0];
      const val = fmtLength(r.value, r.uncertainty, rc.unit, rc.fractionDen);
      const mid = (s.a + s.b) / 2;
      const tagAt = this.split()
        ? this.Q(clamp(mid, 8, L - 8), W / 2)
        : Math.abs(s.b - s.a) > 18
          ? this.Q(mid, this.knobOff())
          : this.Q(clamp(mid, 8, L - 8), W + 2.6);
      if (!this.split() || Math.abs(s.b - s.a) > 14) {
        drawTag(rc, `${r.label} ${val}`, tagAt, n, rc.theme.ink, rc.theme.bg);
      }
      if (s.tool === 'leapfrog' && s.segments.length) {
        drawText(rc, `+${s.segments.length}`, this.Q(Math.max(4, s.a - 4), W + 3), n, {
          sizeMm: 2.6,
          color: rc.theme.accent,
          halo: rc.theme.bg,
        });
      }
      if (rc.selected) {
        drawKnob(rc, this.Q(CAP / 2, W / 2), '#334155', {
          glyph: 'rotate',
          active: rc.activeHandleId === 'rot',
        });
        drawKnob(rc, this.Q(L - CAP / 2, W / 2), '#334155', {
          glyph: 'extend',
          active: rc.activeHandleId === 'end',
        });
      }
    }
  }
}

export function isRulerState(x: unknown): x is RulerState {
  const o = x as RulerState;
  return !!o && o.v === 1 && Array.isArray(o.origin) && typeof o.length === 'number';
}
