// Rectangle · Square piece (§6.7): 4 edge handles, 4 corner handles, rotation, corner radius, square lock.
// Readouts L, W, diagonal, area and perimeter (corner radius taken into account).
import type { Vec } from '../../core/types';
import {
  add,
  dist,
  fitShift,
  normAngle,
  rad2deg,
  rotateAbout,
  scale,
  snapAngle,
  sub,
  dot,
  type RectMm,
} from '../../core/geometry';
import { roundUpOneSig } from '../../core/uncertainty';
import type { Handle, Readout, RenderContext, ToolAction, ToolInstance } from '../../render/types';
import { drawKnob, drawOutline, drawTag, line } from '../../render/draw';
import { fmtLength } from '../../render/format';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../base';
import { at, frameN, frameU, toLocal } from '../frame';

export interface RectState {
  v: 1;
  id: string;
  tool: 'rect';
  n: number;
  placed: boolean;
  c: Vec;
  angle: number;
  w: number;
  h: number;
  r: number;
  square: boolean;
  primary: 'L' | 'W';
}

const KO = 6;
const EDGES: Record<string, Vec> = { e: [1, 0], w: [-1, 0], n: [0, 1], s: [0, -1] };
const CORNERS: Record<string, Vec> = { ne: [1, 1], nw: [-1, 1], se: [1, -1], sw: [-1, -1] };

export function defaultRectState(n = 1, square = false): RectState {
  return {
    v: 1,
    id: newId('rect'),
    tool: 'rect',
    n,
    placed: false,
    c: [0, 0],
    angle: 0,
    w: 40,
    h: square ? 40 : 25,
    r: 0,
    square,
    primary: 'L',
  };
}

export class RectTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool = 'rect' as const;
  s: RectState;
  private drag: { id: string; p0: Vec; s0: RectState; a0: number; snapped: number | null } | null = null;

  constructor(state: RectState) {
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

  /** Local (t, o) in half-size units → mm. */
  private L(t: number, o: number, st = this.s): Vec {
    return at(st.c, st.angle, t, o);
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
    s.w = clamp(b.w * 0.6, 15, 60);
    s.h = s.square ? s.w : clamp(s.w * 0.6, 10, b.h * 0.5);
    s.placed = true;
  }

  private knobPos(id: string, st = this.s): Vec {
    const hw = st.w / 2;
    const hh = st.h / 2;
    if (EDGES[id]) {
      const [x, y] = EDGES[id];
      return this.L(x * (hw + (x ? KO : 0)), y * (hh + (y ? KO : 0)), st);
    }
    if (CORNERS[id]) {
      const [x, y] = CORNERS[id];
      return this.L(x * (hw + KO * 0.7), y * (hh + KO * 0.7), st);
    }
    if (id === 'rot') return this.L(0, hh + KO + 9, st);
    // corner-radius knob: inside the NE corner along the diagonal
    const k = Math.max(st.r, 2) * 0.29 + 5;
    return this.L(hw - k, hh - k, st);
  }

  outline(): Vec[] {
    return ['e', 'w', 'n', 's', 'ne', 'nw', 'se', 'sw', 'rot'].map((id) => this.knobPos(id));
  }

  fit(b: RectMm): void {
    const s = this.s;
    for (let i = 0; i < 20; i++) {
      s.c = add(s.c, fitShift(this.outline(), b));
      const fits = this.outline().every(
        (p) =>
          p[0] >= b.x - 0.01 && p[0] <= b.x + b.w + 0.01 && p[1] >= b.y - 0.01 && p[1] <= b.y + b.h + 0.01,
      );
      if (fits) return;
      s.w *= 0.92;
      s.h *= 0.92;
    }
  }

  rotateBy(deg: number, pivot: Vec): void {
    this.s.c = rotateAbout(this.s.c, pivot, deg);
    this.s.angle = normAngle(this.s.angle + deg);
  }

  corners(): Vec[] {
    const { w, h } = this.s;
    return [this.L(-w / 2, h / 2), this.L(w / 2, h / 2), this.L(w / 2, -h / 2), this.L(-w / 2, -h / 2)];
  }

  snapTargets(): Vec[] {
    return [this.s.c, ...this.corners()];
  }

  focusOf(id: string): Vec | null {
    const s = this.s;
    if (EDGES[id]) return this.L((EDGES[id][0] * s.w) / 2, (EDGES[id][1] * s.h) / 2);
    if (CORNERS[id]) return this.L((CORNERS[id][0] * s.w) / 2, (CORNERS[id][1] * s.h) / 2);
    return null;
  }

  hitTest(p: Vec, tol: number): Handle | null {
    let best: Handle | null = null;
    let bd = Infinity;
    for (const id of ['e', 'w', 'n', 's', 'ne', 'nw', 'se', 'sw', 'rot', 'rad']) {
      const q = this.knobPos(id);
      const d = dist(p, q);
      if (d <= tol && d < bd) {
        bd = d;
        best = { id, kind: id === 'rot' ? 'rotate' : 'edge', posMm: q };
      }
    }
    if (best) return best;
    const [t, o] = toLocal(this.s.c, this.s.angle, p);
    if (Math.abs(t) <= this.s.w / 2 && Math.abs(o) <= this.s.h / 2)
      return { id: 'body', kind: 'body', posMm: p };
    return null;
  }

  onDragStart(h: Handle, p: Vec): void {
    this.drag = {
      id: h.id,
      p0: p,
      s0: structuredClone(this.s),
      a0: rad2deg(Math.atan2(p[1] - this.s.c[1], p[0] - this.s.c[0])),
      snapped: null,
    };
  }

  onDragMove(h: Handle, p: Vec, _precision = false): void {
    const d = this.drag;
    if (!d) return;
    const s = this.s;
    const s0 = d.s0;
    const delta = sub(p, d.p0);
    const u = frameU(s0.angle);
    const n = frameN(s0.angle);
    const du = dot(delta, u);
    const dn = dot(delta, n);
    const id = h.id;
    if (EDGES[id] || CORNERS[id]) {
      const [sx, sy] = EDGES[id] ?? CORNERS[id];
      let dw = sx * du;
      let dh = sy * dn;
      if (s.square) {
        const k = sx && sy ? (dw + dh) / 2 : sx ? dw : dh;
        dw = k;
        dh = k;
      }
      const w = Math.max(1, s0.w + dw);
      const hgt = Math.max(1, s0.h + dh);
      // Opposite edge / corner stays put.
      s.c = add(add(s0.c, scale(u, (sx * (w - s0.w)) / 2)), scale(n, (sy * (hgt - s0.h)) / 2));
      s.w = w;
      s.h = hgt;
      s.r = Math.min(s.r, Math.min(w, hgt) / 2);
      s.primary = Math.abs(sx) >= Math.abs(sy) ? 'L' : 'W';
      return;
    }
    if (id === 'rad') {
      s.r = clamp(s0.r - (du + dn) / (2 * 0.29), 0, Math.min(s.w, s.h) / 2);
      return;
    }
    if (id === 'rot') {
      let a = normAngle(s0.angle + normAngle(rad2deg(Math.atan2(p[1] - s0.c[1], p[0] - s0.c[0])) - d.a0));
      if (this.env.angleSnap()) {
        const [sa, ok] = snapAngle(a, 15, 2);
        if (ok) {
          if (d.snapped !== sa) this.snapHaptic();
          d.snapped = sa;
          a = normAngle(sa);
        } else d.snapped = null;
      }
      s.angle = a;
      return;
    }
    s.c = add(s0.c, delta);
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  wheel(stepMm: number): void {
    const s = this.s;
    if (s.primary === 'W' && !s.square) s.h = Math.max(1, s.h + stepMm);
    else {
      s.w = Math.max(1, s.w + stepMm);
      if (s.square) s.h = s.w;
    }
  }

  setExactValue(handleId: string, valueMm: number): boolean {
    const s = this.s;
    if (!(valueMm > 0)) return false;
    if (handleId === 'n' || handleId === 's') s.h = valueMm;
    else s.w = valueMm;
    if (s.square) s.h = s.w = valueMm;
    return true;
  }

  actions(): ToolAction[] {
    const s = this.s;
    return [
      {
        id: 'square',
        labelKey: 'rect.square',
        active: s.square,
        run: () => {
          s.square = !s.square;
          if (s.square) s.h = s.w = Math.max(s.w, s.h);
        },
      },
      { id: 'rot90', labelKey: 'action.rotate90', run: () => this.rotateBy(90, s.c) },
    ];
  }

  readouts(): Readout[] {
    const s = this.s;
    const u = frameU(s.angle);
    const n = frameN(s.angle);
    const UL = this.env.uncertainty(s.w, u, 2);
    const UW = this.env.uncertainty(s.h, n, 2);
    const diag = Math.hypot(s.w, s.h);
    const area = s.w * s.h - (4 - Math.PI) * s.r * s.r;
    const per = 2 * (s.w + s.h) - 8 * s.r + 2 * Math.PI * s.r;
    const out: Readout[] = [
      {
        label: `L${s.n}`,
        kind: 'length',
        value: s.w,
        uncertainty: UL,
        primary: s.primary === 'L' || s.square,
        unit: 'length',
        nameKey: s.square ? 'readout.side' : 'readout.length',
      },
    ];
    if (!s.square)
      out.push({
        label: `W${s.n}`,
        kind: 'width',
        value: s.h,
        uncertainty: UW,
        primary: s.primary === 'W',
        unit: 'length',
        nameKey: 'kind.width',
      });
    out.push(
      {
        label: 'D',
        kind: 'length',
        value: diag,
        uncertainty: roundUpOneSig(Math.hypot((s.w * UL) / diag, (s.h * UW) / diag)),
        unit: 'length',
        nameKey: 'readout.diagonal',
      },
      {
        label: 'AR',
        kind: 'area',
        value: area,
        uncertainty: roundUpOneSig(Math.hypot(s.h * UL, s.w * UW)),
        unit: 'area',
        nameKey: 'readout.area',
      },
      {
        label: 'PE',
        kind: 'perimeter',
        value: per,
        uncertainty: roundUpOneSig(2 * Math.hypot(UL, UW)),
        unit: 'length',
        nameKey: 'kind.perimeter',
      },
    );
    if (s.r > 0.05)
      out.push({
        label: 'R',
        kind: 'radius',
        value: s.r,
        uncertainty: UL,
        unit: 'length',
        nameKey: 'kind.radius',
      });
    return out;
  }

  toMeasurements(): ToolMeasurement[] {
    return this.readouts()
      .filter(
        (r) =>
          (r.kind === 'length' && r.nameKey !== 'readout.diagonal') ||
          r.kind === 'width' ||
          r.kind === 'radius',
      )
      .map((r) => ({
        tool: this.tool,
        kind: r.kind,
        label: r.label,
        value: r.value,
        uncertainty: r.uncertainty,
        toolState: this.serialize(),
      }));
  }

  serialize(): RectState {
    return structuredClone(this.s);
  }

  private shape(): Vec[] {
    const s = this.s;
    const r = Math.min(s.r, s.w / 2, s.h / 2);
    if (r < 0.05) return this.corners();
    const pts: Vec[] = [];
    const cs: [number, number, number][] = [
      [s.w / 2 - r, s.h / 2 - r, 0],
      [-s.w / 2 + r, s.h / 2 - r, 90],
      [-s.w / 2 + r, -s.h / 2 + r, 180],
      [s.w / 2 - r, -s.h / 2 + r, 270],
    ];
    for (const [cx, cy, a0] of cs) {
      for (let k = 0; k <= 8; k++) {
        const a = ((a0 + (k * 90) / 8) * Math.PI) / 180;
        pts.push(this.L(cx + r * Math.cos(a), cy + r * Math.sin(a)));
      }
    }
    return pts;
  }

  render(rc: RenderContext): void {
    const s = this.s;
    const { ctx } = rc;
    drawOutline(rc, this.shape(), true, rc.theme.accent, 'rgba(14,165,233,0.08)');
    // Diagonal (dashed).
    const cs = this.corners();
    ctx.save();
    ctx.strokeStyle = rc.theme.ink;
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([3 * rc.dpr, 3 * rc.dpr]);
    ctx.beginPath();
    line(ctx, rc.mmToPx(cs[0]), rc.mmToPx(cs[2]));
    ctx.stroke();
    ctx.restore();
    if (rc.inLoupe) return;
    const rs = this.readouts();
    const n = frameN(s.angle);
    drawTag(
      rc,
      `${rs[0].label} ${fmtLength(rs[0].value, rs[0].uncertainty, rc.unit, rc.fractionDen)}`,
      this.L(0, s.h / 2 - 3.5),
      n,
      rc.theme.ink,
      rc.theme.bg,
    );
    if (!s.square) {
      drawTag(
        rc,
        `${rs[1].label} ${fmtLength(rs[1].value, rs[1].uncertainty, rc.unit, rc.fractionDen)}`,
        this.L(s.w / 2 - 9, 0),
        n,
        rc.theme.accent2,
        '#ffffff',
      );
    }
    for (const id of ['e', 'w', 'n', 's']) {
      const f = this.focusOf(id)!;
      const q = this.knobPos(id);
      ctx.save();
      ctx.strokeStyle = rc.theme.accent;
      ctx.lineWidth = 1.5 * rc.dpr;
      ctx.beginPath();
      line(ctx, rc.mmToPx(f), rc.mmToPx(q));
      ctx.stroke();
      ctx.restore();
      drawKnob(rc, q, rc.theme.accent, { active: rc.activeHandleId === id });
    }
    for (const id of ['ne', 'nw', 'se', 'sw'])
      drawKnob(rc, this.knobPos(id), rc.theme.accent2, { active: rc.activeHandleId === id });
    drawKnob(rc, this.knobPos('rot'), '#334155', { glyph: 'rotate', active: rc.activeHandleId === 'rot' });
    if (rc.selected) drawKnob(rc, this.knobPos('rad'), '#64748b', { active: rc.activeHandleId === 'rad' });
  }
}

export function isRectState(x: unknown): x is RectState {
  const o = x as RectState;
  return !!o && o.tool === 'rect' && typeof o.w === 'number';
}
