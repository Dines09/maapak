// L × W box: four lines around the part. Inside stays bright, outside is dimmed; tick marks run along
// the box edges (zero at the left / bottom line). Drag the grips, or drag anywhere in the dimmed area:
// left/right of the box moves that side, above/below moves top/bottom, diagonally moves the corner.
import type { Vec } from '../../core/types';
import {
  add,
  clipLineToRect,
  dist,
  dot,
  inRect,
  normAngle,
  rotateAbout,
  scale,
  sub,
  type RectMm,
} from '../../core/geometry';
import { roundUpOneSig } from '../../core/uncertainty';
import type { Handle, Readout, RenderContext, ToolAction, ToolInstance } from '../../render/types';
import { drawKnob, drawMarkerLine, drawScale, type ScaleKind } from '../../render/draw';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../base';
import { at, frameN, frameU, toLocal } from '../frame';
import { TICK_SCALE } from '../ruler/RulerTool';
import { ghostFrom, linear, rectPts } from '../drawing';
import type { DrawingEntities, GhostShape } from '../../render/types';

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

const GRIP = 7; // grip offset outside the box

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
  private keys(st = this.s): {
    left: 'x1' | 'x2';
    right: 'x1' | 'x2';
    bottom: 'y1' | 'y2';
    top: 'y1' | 'y2';
  } {
    return {
      left: st.x1 <= st.x2 ? 'x1' : 'x2',
      right: st.x1 <= st.x2 ? 'x2' : 'x1',
      bottom: st.y1 <= st.y2 ? 'y1' : 'y2',
      top: st.y1 <= st.y2 ? 'y2' : 'y1',
    };
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
    const hw = clamp(b.w * 0.3, 8, 40);
    const hh = clamp(b.h * 0.22, 6, 35);
    Object.assign(s, { angle: 0, x1: -hw, x2: hw, y1: -hh, y2: hh, placed: true });
  }

  private grips(): [LineId, Vec][] {
    const s = this.s;
    const b = this.env.bounds();
    const [xl, xr] = this.xs();
    const [yb, yt] = this.ys();
    const gy = inRect(this.A(0, yb - GRIP - 2), b) ? yb - GRIP : yt + GRIP;
    const gx = inRect(this.A(xr + GRIP + 2, 0), b) ? xr + GRIP : xl - GRIP;
    return [
      ['x1', this.A(s.x1, gy)],
      ['x2', this.A(s.x2, gy)],
      ['y1', this.A(gx, s.y1)],
      ['y2', this.A(gx, s.y2)],
    ];
  }

  outline(): Vec[] {
    const [xl, xr] = this.xs();
    const [yb, yt] = this.ys();
    return [this.A(xl, yb), this.A(xr, yb), this.A(xr, yt), this.A(xl, yt)];
  }

  spotlight(): Vec[][] {
    return [this.outline()];
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
    const ks = id.replace('ind:', '').split(',').filter(Boolean) as LineId[];
    if (!ks.length) return null;
    const [xl, xr] = this.xs();
    const [yb, yt] = this.ys();
    const kx = ks.find((k) => k[0] === 'x');
    const ky = ks.find((k) => k[0] === 'y');
    return this.A(kx ? s[kx] : (xl + xr) / 2, ky ? s[ky] : (yb + yt) / 2);
  }

  hitTest(p: Vec, tol: number): Handle | null {
    let best: Handle | null = null;
    let bd = Infinity;
    for (const [id, q] of this.grips()) {
      const d = dist(p, q);
      if (d <= tol && d < bd) {
        bd = d;
        best = { id, kind: 'edge', posMm: q };
      }
    }
    return best;
  }

  /** 9-zone drive from the dimmed area; the inside of the box (the part) is protected. */
  indirect(p: Vec): Handle | null {
    const [t, o] = toLocal(this.s.c, this.s.angle, p);
    const [xl, xr] = this.xs();
    const [yb, yt] = this.ys();
    const k = this.keys();
    const kx = t < xl ? k.left : t > xr ? k.right : null;
    const ky = o < yb ? k.bottom : o > yt ? k.top : null;
    if (!kx && !ky) return null;
    return { id: `ind:${[kx, ky].filter(Boolean).join(',')}`, kind: 'point', posMm: p };
  }

  onDragStart(h: Handle, p: Vec): void {
    const first = h.id.replace('ind:', '').split(',')[0];
    if (first === 'x1' || first === 'x2' || first === 'y1' || first === 'y2') this.last = first;
    this.drag = { id: h.id, p0: p, s0: structuredClone(this.s), snapped: null };
  }

  onDragMove(h: Handle, p: Vec, _precision = false): void {
    const d = this.drag;
    if (!d) return;
    const s = this.s;
    const s0 = d.s0;
    const delta = sub(p, d.p0);
    const ids = h.id.replace('ind:', '').split(',').filter(Boolean) as LineId[];
    for (const id of ids) {
      if (!['x1', 'x2', 'y1', 'y2'].includes(id)) continue;
      const horizontalAxis = id[0] === 'x';
      const dv = dot(delta, horizontalAxis ? frameU(s0.angle) : frameN(s0.angle));
      let v = s0[id] + dv;
      const step = this.env.tickSnapMm();
      if (step > 0) {
        const other = s0[horizontalAxis ? (id === 'x1' ? 'x2' : 'x1') : id === 'y1' ? 'y2' : 'y1'];
        const snapped = other + Math.round((v - other) / step) * step;
        if (Math.abs(snapped - v) <= Math.min(step * 0.3, 0.35)) {
          if (d.snapped !== snapped) this.snapHaptic();
          d.snapped = snapped;
          v = snapped;
        }
      }
      if (this.lineVisible(id, { ...s, [id]: v })) s[id] = v;
      s.primary = horizontalAxis ? 'L' : 'W';
    }
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  wheel(stepMm: number): void {
    const s = this.s;
    const k = this.last;
    const other = s[k === 'x1' ? 'x2' : k === 'x2' ? 'x1' : k === 'y1' ? 'y2' : 'y1'];
    const sign = s[k] >= other ? 1 : -1;
    const trial = { ...s, [k]: s[k] + sign * stepMm };
    if (this.lineVisible(k, trial)) s[k] = trial[k];
  }

  setExactValue(handleId: string, valueMm: number): boolean {
    const s = this.s;
    if (!(valueMm > 0)) return false;
    const id = handleId.replace('ind:', '').split(',')[0];
    if (id === 'x1') s.x1 = s.x2 - valueMm * Math.sign(s.x2 - s.x1 || 1);
    else if (id === 'x2') s.x2 = s.x1 + valueMm * Math.sign(s.x2 - s.x1 || 1);
    else if (id === 'y1') s.y1 = s.y2 - valueMm * Math.sign(s.y2 - s.y1 || 1);
    else if (id === 'y2') s.y2 = s.y1 + valueMm * Math.sign(s.y2 - s.y1 || 1);
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

  toDrawing(): DrawingEntities {
    const s = this.s;
    const L = Math.abs(s.x2 - s.x1);
    const W = Math.abs(s.y2 - s.y1);
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
      { kind: 'polyline', points: rectPts(Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1)), closed: true },
    ]);
  }

  serialize(): BoxState {
    return structuredClone(this.s);
  }

  render(rc: RenderContext): void {
    const s = this.s;
    const b = this.env.bounds();
    const u = frameU(s.angle);
    const n = frameN(s.angle);
    const [xl, xr] = this.xs();
    const [yb, yt] = this.ys();
    const kind: ScaleKind = rc.unit === 'mm' ? 'mm' : rc.unit === 'cm' ? 'cm' : 'inch';
    const scaleOpts = {
      kind,
      ink: rc.theme.ink,
      inchDen: rc.fractionDen,
      tickScale: TICK_SCALE,
      labelSize: 2.2,
    };
    // Ticks along the top edge (length, from the left line) and the left edge (width, from the bottom line).
    drawScale(rc, {
      ...scaleOpts,
      zero: this.A(xl, yt),
      dir: u,
      normal: scale(n, -1),
      from: 0,
      to: xr - xl,
      textUp: n,
    });
    drawScale(rc, {
      ...scaleOpts,
      zero: this.A(xl, yb),
      dir: n,
      normal: u,
      from: 0,
      to: yt - yb,
      textUp: scale(u, -1),
    });
    const lines: [LineId, Vec, Vec, string][] = [
      ['x1', this.A(s.x1, 0), n, rc.theme.accent],
      ['x2', this.A(s.x2, 0), n, rc.theme.accent],
      ['y1', this.A(0, s.y1), u, rc.theme.accent2],
      ['y2', this.A(0, s.y2), u, rc.theme.accent2],
    ];
    for (const [, base, dir, color] of lines) {
      const r = clipLineToRect(base, dir, b);
      if (r) drawMarkerLine(rc, add(base, scale(dir, r[0])), base, add(base, scale(dir, r[1])), color);
    }
    if (rc.inLoupe) return;
    const active = rc.activeHandleId ?? '';
    for (const [id, q] of this.grips()) {
      drawKnob(rc, q, id[0] === 'x' ? rc.theme.accent : rc.theme.accent2, {
        active: active === id || (active.startsWith('ind:') && active.includes(id)),
      });
    }
  }
}

export function isBoxState(x: unknown): x is BoxState {
  const o = x as BoxState;
  return !!o && o.tool === 'box' && typeof o.x1 === 'number';
}
