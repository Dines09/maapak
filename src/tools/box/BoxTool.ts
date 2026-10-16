// L × W box: put the part on the screen and drag four solid lines onto its four edges. Two thin scales
// ride on the lines (zero at the left / bottom line), so the numbers under the other lines are L and W.
import type { Vec } from '../../core/types';
import {
  add,
  clipLineToRect,
  dist,
  dot,
  inRect,
  normAngle,
  rotateAbout,
  sub,
  type RectMm,
} from '../../core/geometry';
import { roundUpOneSig } from '../../core/uncertainty';
import type { Handle, Readout, RenderContext, ToolAction, ToolInstance } from '../../render/types';
import { SKINS, skinInk } from '../../render/skins';
import { drawKnob, drawMarkerLine, drawScale, polygonPx, type ScaleKind } from '../../render/draw';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../base';
import { at, frameN, frameU, toLocal } from '../frame';
import { STRIP, TICK_SCALE } from '../ruler/RulerTool';

export interface BoxState {
  v: 1;
  id: string;
  tool: 'box';
  n: number;
  placed: boolean;
  c: Vec;
  angle: number;
  /** Line positions in the local frame: x along u (vertical lines), y along n (horizontal lines). */
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  primary: 'L' | 'W';
}

const GAP = 1.5; // scale band offset from its line
const KO = 6; // knob offset beyond the box

export function defaultBoxState(n = 1): BoxState {
  return {
    v: 1,
    id: newId('box'),
    tool: 'box',
    n,
    placed: false,
    c: [0, 0],
    angle: 0,
    x1: -20,
    x2: 20,
    y1: -12,
    y2: 12,
    primary: 'L',
  };
}

type LineId = 'x1' | 'x2' | 'y1' | 'y2';

export class BoxTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool = 'box' as const;
  s: BoxState;
  private drag: { id: string; p0: Vec; s0: BoxState; snapped: number | null } | null = null;
  private last: LineId = 'x2';

  constructor(state: BoxState) {
    super();
    this.s = structuredClone(state);
    this.id = state.id;
  }

  get label(): string {
    return `L${this.s.n}`;
  }
  set label(v: string) {
    const m = /(\d+)$/.exec(v);
    if (m) this.s.n = Number(m[1]);
  }

  private A(t: number, o: number, st = this.s): Vec {
    return at(st.c, st.angle, t, o);
  }
  private xs(): [number, number] {
    return [Math.min(this.s.x1, this.s.x2), Math.max(this.s.x1, this.s.x2)];
  }
  private ys(): [number, number] {
    return [Math.min(this.s.y1, this.s.y2), Math.max(this.s.y1, this.s.y2)];
  }
  angle(): number {
    return this.s.angle;
  }

  attach(env: Parameters<BaseTool['attach']>[0]): void {
    super.attach(env);
    if (this.s.placed) return;
    const b = env.placeBounds();
    const s = this.s;
    s.c = [b.x + b.w / 2, b.y + b.h / 2];
    const hw = clamp(b.w * 0.28, 8, 40);
    const hh = clamp(b.h * 0.2, 6, 30);
    Object.assign(s, { angle: 0, x1: -hw, x2: hw, y1: -hh, y2: hh, placed: true });
  }

  /** Scales go on the side of the box with room; returns the band offsets. */
  private layout() {
    const b = this.env.bounds();
    const [xl, xr] = this.xs();
    const [yb, yt] = this.ys();
    const mid: Vec = [(xl + xr) / 2, (yb + yt) / 2];
    const topOk = inRect(this.A(mid[0], yt + GAP + STRIP + 1), b);
    const leftOk = inRect(this.A(xl - GAP - STRIP - 1, mid[1]), b);
    const hBand: [number, number] = topOk ? [yt + GAP, yt + GAP + STRIP] : [yb - GAP - STRIP, yb - GAP];
    const vBand: [number, number] = leftOk ? [xl - GAP - STRIP, xl - GAP] : [xr + GAP, xr + GAP + STRIP];
    const belowOk = inRect(this.A(mid[0], yb - KO - 2), b);
    const rightOk = inRect(this.A(xr + KO + 2, mid[1]), b);
    return {
      hBand,
      vBand,
      knobY: belowOk ? yb - KO : yt + KO + (topOk ? STRIP + GAP : 0),
      knobX: rightOk ? xr + KO : xl - KO - (leftOk ? STRIP + GAP : 0),
      topOk,
      leftOk,
    };
  }

  private knobs(): [LineId, Vec][] {
    const s = this.s;
    const l = this.layout();
    return [
      ['x1', this.A(s.x1, l.knobY)],
      ['x2', this.A(s.x2, l.knobY)],
      ['y1', this.A(l.knobX, s.y1)],
      ['y2', this.A(l.knobX, s.y2)],
    ];
  }

  outline(): Vec[] {
    const [xl, xr] = this.xs();
    const [yb, yt] = this.ys();
    return [this.A(xl, yb), this.A(xr, yb), this.A(xr, yt), this.A(xl, yt)];
  }

  fit(b: RectMm): void {
    const s = this.s;
    s.c = [clamp(s.c[0], b.x, b.x + b.w), clamp(s.c[1], b.y, b.y + b.h)];
    for (const k of ['x1', 'x2', 'y1', 'y2'] as const) {
      for (let i = 0; i < 30 && !this.lineVisible(k); i++) s[k] *= 0.9;
    }
  }

  private lineVisible(k: LineId, st = this.s): boolean {
    const b = this.env.bounds();
    const p = k[0] === 'x' ? this.A(st[k], (st.y1 + st.y2) / 2, st) : this.A((st.x1 + st.x2) / 2, st[k], st);
    return inRect(p, b);
  }

  rotateBy(deg: number, pivot: Vec): void {
    this.s.c = rotateAbout(this.s.c, pivot, deg);
    this.s.angle = normAngle(this.s.angle + deg);
  }

  snapTargets(): Vec[] {
    return this.outline();
  }

  focusOf(id: string): Vec | null {
    const s = this.s;
    const [yb, yt] = this.ys();
    const [xl, xr] = this.xs();
    if (id === 'x1' || id === 'x2') return this.A(s[id], (yb + yt) / 2);
    if (id === 'y1' || id === 'y2') return this.A((xl + xr) / 2, s[id]);
    return null;
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
    const [t, o] = toLocal(this.s.c, this.s.angle, p);
    const [xl, xr] = this.xs();
    const [yb, yt] = this.ys();
    if (t >= xl && t <= xr && o >= yb && o <= yt) return { id: 'body', kind: 'body', posMm: p };
    return null;
  }

  onDragStart(h: Handle, p: Vec): void {
    if (h.id === 'x1' || h.id === 'x2' || h.id === 'y1' || h.id === 'y2') this.last = h.id;
    this.drag = { id: h.id, p0: p, s0: structuredClone(this.s), snapped: null };
  }

  onDragMove(h: Handle, p: Vec, _precision = false): void {
    const d = this.drag;
    if (!d) return;
    const s = this.s;
    const s0 = d.s0;
    const delta = sub(p, d.p0);
    if (h.id === 'body') {
      s.c = add(s0.c, delta);
      return;
    }
    const id = h.id as LineId;
    const horizontalAxis = id[0] === 'x';
    const dv = dot(delta, horizontalAxis ? frameU(s0.angle) : frameN(s0.angle));
    let v = s0[id] + dv;
    // Tick snapping on the distance to the opposite line.
    const step = this.env.tickSnapMm();
    if (step > 0) {
      const other = s0[horizontalAxis ? (id === 'x1' ? 'x2' : 'x1') : id === 'y1' ? 'y2' : 'y1'];
      const dist0 = v - other;
      const snapped = other + Math.round(dist0 / step) * step;
      if (Math.abs(snapped - v) <= Math.min(step * 0.3, 0.35)) {
        if (d.snapped !== snapped) this.snapHaptic();
        d.snapped = snapped;
        v = snapped;
      } else d.snapped = null;
    }
    const trial = { ...s, [id]: v };
    if (this.lineVisible(id, trial)) s[id] = v;
    s.primary = horizontalAxis ? 'L' : 'W';
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  wheel(stepMm: number): void {
    const s = this.s;
    const k = this.last;
    const sign =
      k === 'x1' || k === 'y1'
        ? s[k] <= s[k === 'x1' ? 'x2' : 'y2']
          ? -1
          : 1
        : s[k] >= s[k === 'x2' ? 'x1' : 'y1']
          ? 1
          : -1;
    const trial = { ...s, [k]: s[k] + sign * stepMm };
    if (this.lineVisible(k, trial)) s[k] = trial[k];
  }

  setExactValue(handleId: string, valueMm: number): boolean {
    const s = this.s;
    if (!(valueMm > 0)) return false;
    if (handleId === 'x1') s.x1 = s.x2 - valueMm * Math.sign(s.x2 - s.x1 || 1);
    else if (handleId === 'x2') s.x2 = s.x1 + valueMm * Math.sign(s.x2 - s.x1 || 1);
    else if (handleId === 'y1') s.y1 = s.y2 - valueMm * Math.sign(s.y2 - s.y1 || 1);
    else if (handleId === 'y2') s.y2 = s.y1 + valueMm * Math.sign(s.y2 - s.y1 || 1);
    else return false;
    return true;
  }

  actions(): ToolAction[] {
    return [{ id: 'rot90', labelKey: 'action.rotate90', run: () => this.rotateBy(90, this.s.c) }];
  }

  readouts(): Readout[] {
    const s = this.s;
    const L = Math.abs(s.x2 - s.x1);
    const W = Math.abs(s.y2 - s.y1);
    const UL = this.env.uncertainty(L, frameU(s.angle), 2);
    const UW = this.env.uncertainty(W, frameN(s.angle), 2);
    const D = Math.hypot(L, W) || 1;
    return [
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
        label: `W${s.n}`,
        kind: 'width',
        value: W,
        uncertainty: UW,
        primary: s.primary === 'W',
        unit: 'length',
        nameKey: 'kind.width',
      },
      {
        label: 'AR',
        kind: 'area',
        value: L * W,
        uncertainty: roundUpOneSig(Math.hypot(W * UL, L * UW)),
        unit: 'area',
        nameKey: 'readout.area',
      },
      {
        label: 'D',
        kind: 'length',
        value: D,
        uncertainty: roundUpOneSig(Math.hypot((L * UL) / D, (W * UW) / D)),
        unit: 'length',
        nameKey: 'readout.diagonal',
      },
    ];
  }

  toMeasurements(): ToolMeasurement[] {
    return this.readouts()
      .slice(0, 2)
      .map((r) => ({
        tool: this.tool,
        kind: r.kind,
        label: r.label,
        value: r.value,
        uncertainty: r.uncertainty,
        toolState: this.serialize(),
      }));
  }

  serialize(): BoxState {
    return structuredClone(this.s);
  }

  render(rc: RenderContext): void {
    const { ctx } = rc;
    const s = this.s;
    const b = this.env.bounds();
    const u = frameU(s.angle);
    const n = frameN(s.angle);
    const l = this.layout();
    const [xl, xr] = this.xs();
    const [yb, yt] = this.ys();
    const skin = SKINS[rc.theme.skin];
    const ink = skinInk(skin, rc.theme.bg);
    const kind: ScaleKind = rc.unit === 'mm' ? 'mm' : rc.unit === 'cm' ? 'cm' : 'inch';

    // Light fill so the measured footprint is obvious.
    ctx.save();
    polygonPx(
      ctx,
      this.outline().map((p) => rc.mmToPx(p)),
    );
    ctx.fillStyle = rc.theme.accent;
    ctx.globalAlpha = 0.07;
    ctx.fill();
    ctx.restore();

    // Thin scales: horizontal one (zero at the left line) and vertical one (zero at the bottom line).
    const band = (pts: Vec[], draw: () => void) => {
      const px = pts.map((p) => rc.mmToPx(p));
      ctx.save();
      polygonPx(ctx, px);
      ctx.fillStyle = skin.body;
      ctx.globalAlpha = skin.alpha < 1 ? skin.alpha : 0.82;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.clip();
      draw();
      ctx.restore();
    };
    const hr = clipLineToRect(this.A(0, (l.hBand[0] + l.hBand[1]) / 2), u, b);
    if (hr) {
      const t0 = Math.max(hr[0], xl - 12);
      const t1 = Math.min(hr[1], xr + 12);
      const edge = l.topOk ? l.hBand[0] : l.hBand[1];
      const normal: Vec = l.topOk ? n : [-n[0], -n[1]];
      band(
        [this.A(t0, l.hBand[0]), this.A(t1, l.hBand[0]), this.A(t1, l.hBand[1]), this.A(t0, l.hBand[1])],
        () =>
          drawScale(rc, {
            zero: this.A(xl, edge),
            dir: u,
            normal,
            from: t0 - xl,
            to: t1 - xl,
            kind,
            ink,
            textUp: n,
            inchDen: rc.fractionDen,
            tickScale: TICK_SCALE,
            labelSize: 2,
          }),
      );
    }
    const vr = clipLineToRect(this.A((l.vBand[0] + l.vBand[1]) / 2, 0), n, b);
    if (vr) {
      const o0 = Math.max(vr[0], yb - 12);
      const o1 = Math.min(vr[1], yt + 12);
      const edge = l.leftOk ? l.vBand[1] : l.vBand[0];
      const normal: Vec = l.leftOk ? [-u[0], -u[1]] : u;
      band(
        [this.A(l.vBand[0], o0), this.A(l.vBand[1], o0), this.A(l.vBand[1], o1), this.A(l.vBand[0], o1)],
        () =>
          drawScale(rc, {
            zero: this.A(edge, yb),
            dir: n,
            normal,
            from: o0 - yb,
            to: o1 - yb,
            kind,
            ink,
            textUp: normal,
            inchDen: rc.fractionDen,
            tickScale: TICK_SCALE,
            labelSize: 2,
          }),
      );
    }

    // Four solid full-span lines.
    const colors = [rc.theme.accent, rc.theme.accent, rc.theme.accent2, rc.theme.accent2];
    (['x1', 'x2', 'y1', 'y2'] as const).forEach((k, i) => {
      const isX = k[0] === 'x';
      const base = isX ? this.A(s[k], 0) : this.A(0, s[k]);
      const dir = isX ? n : u;
      const r = clipLineToRect(base, dir, b);
      if (!r) return;
      drawMarkerLine(
        rc,
        add(base, [dir[0] * r[0], dir[1] * r[0]]),
        base,
        add(base, [dir[0] * r[1], dir[1] * r[1]]),
        colors[i],
      );
    });
    if (rc.inLoupe) return;
    for (const [id, q] of this.knobs())
      drawKnob(rc, q, id[0] === 'x' ? rc.theme.accent : rc.theme.accent2, {
        active: rc.activeHandleId === id,
      });
  }
}

export function isBoxState(x: unknown): x is BoxState {
  const o = x as BoxState;
  return !!o && o.tool === 'box' && typeof o.x1 === 'number';
}
