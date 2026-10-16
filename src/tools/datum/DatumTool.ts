// Datum XY (§6.7): set an origin and the X axis along a datum edge, then place feature points → X/Y table.
import type { Vec } from '../../core/types';
import {
  add,
  dirOf,
  dist,
  dot,
  normAngle,
  rad2deg,
  scale,
  snapAngle,
  sub,
  type RectMm,
} from '../../core/geometry';
import { roundUpOneSig } from '../../core/uncertainty';
import type { Handle, Readout, RenderContext, ToolAction, ToolInstance } from '../../render/types';
import { drawKnob, drawMarkerLine, drawText } from '../../render/draw';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../base';

export interface DatumState {
  v: 1;
  id: string;
  tool: 'datumXY';
  n: number;
  placed: boolean;
  origin: Vec;
  /** X axis direction (deg, screen). */
  angle: number;
  pts: Vec[];
}

export function defaultDatumState(n = 1): DatumState {
  return { v: 1, id: newId('dat'), tool: 'datumXY', n, placed: false, origin: [0, 0], angle: 0, pts: [] };
}

export class DatumTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool = 'datumXY' as const;
  label = 'XY';
  s: DatumState;
  private drag: { id: string; p0: Vec; s0: DatumState; snapped: number | null } | null = null;

  constructor(state: DatumState) {
    super();
    this.s = structuredClone(state);
    this.id = state.id;
  }

  private ux(): Vec {
    return dirOf(this.s.angle);
  }
  /** +Y is "up" (90° counter-clockwise from +X on screen). */
  private uy(): Vec {
    const u = this.ux();
    return [u[1], -u[0]];
  }
  /** Coordinates of a point in the datum frame. */
  xy(p: Vec): Vec {
    const d = sub(p, this.s.origin);
    return [dot(d, this.ux()), dot(d, this.uy())];
  }
  angle(): number {
    return this.s.angle;
  }

  attach(env: Parameters<BaseTool['attach']>[0]): void {
    super.attach(env);
    if (this.s.placed) return;
    const b = env.placeBounds();
    const s = this.s;
    s.origin = [b.x + 8, b.y + b.h * 0.7];
    s.pts = [add(s.origin, [20, -15]), add(s.origin, [35, -30])];
    s.placed = true;
  }

  private axisKnob(): Vec {
    return add(this.s.origin, scale(this.ux(), 30));
  }

  fit(b: RectMm): void {
    const s = this.s;
    s.origin = [clamp(s.origin[0], b.x, b.x + b.w), clamp(s.origin[1], b.y, b.y + b.h)];
    s.pts = s.pts.map((p) => [clamp(p[0], b.x, b.x + b.w), clamp(p[1], b.y, b.y + b.h)] as Vec);
  }

  snapTargets(): Vec[] {
    return [this.s.origin, ...this.s.pts];
  }

  focusOf(id: string): Vec | null {
    if (id === 'o') return this.s.origin;
    if (id === 'ax') return this.axisKnob();
    const m = /^p(\d+)$/.exec(id);
    return m ? this.s.pts[Number(m[1])] : null;
  }

  hitTest(p: Vec, tol: number): Handle | null {
    const cands: [string, Vec][] = [
      ['o', this.s.origin],
      ['ax', this.axisKnob()],
      ...this.s.pts.map((q, i) => [`p${i}`, q] as [string, Vec]),
    ];
    let best: Handle | null = null;
    let bd = Infinity;
    for (const [id, q] of cands) {
      const d = dist(p, q);
      if (d <= tol && d < bd) {
        bd = d;
        best = { id, kind: id === 'ax' ? 'rotate' : 'point', posMm: q };
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
    const delta = sub(p, d.p0);
    if (h.id === 'o') s.origin = add(d.s0.origin, delta);
    else if (h.id === 'ax') {
      let a = normAngle(rad2deg(Math.atan2(p[1] - s.origin[1], p[0] - s.origin[0])));
      if (this.env.angleSnap()) {
        const [sa, ok] = snapAngle(a, 90, 2);
        if (ok) {
          if (d.snapped !== sa) this.snapHaptic();
          d.snapped = sa;
          a = sa;
        } else d.snapped = null;
      }
      s.angle = a;
    } else {
      const m = /^p(\d+)$/.exec(h.id);
      if (m) s.pts[Number(m[1])] = add(d.s0.pts[Number(m[1])], delta);
    }
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  actions(): ToolAction[] {
    const s = this.s;
    return [
      {
        id: 'add',
        labelKey: 'datum.add',
        run: () => {
          const last = s.pts[s.pts.length - 1] ?? s.origin;
          s.pts.push(add(last, scale(this.ux(), 8)));
        },
      },
      { id: 'remove', labelKey: 'datum.remove', run: () => void s.pts.pop() },
    ];
  }

  readouts(): Readout[] {
    const u = this.env.pointU();
    const out: Readout[] = [];
    this.s.pts.forEach((p, i) => {
      const [x, y] = this.xy(p);
      const U = roundUpOneSig(2 * Math.hypot(u, u) + Math.hypot(x, y) * this.env.relCal() * 2);
      out.push({
        label: `X${i + 1}`,
        kind: 'coordinate',
        value: x,
        uncertainty: U,
        primary: i === 0,
        unit: 'length',
      });
      out.push({ label: `Y${i + 1}`, kind: 'coordinate', value: y, uncertainty: U, unit: 'length' });
    });
    if (!out.length)
      out.push({ label: 'XY', kind: 'coordinate', value: 0, uncertainty: 0, primary: true, unit: 'count' });
    return out;
  }

  toMeasurements(): ToolMeasurement[] {
    return this.readouts()
      .filter((r) => r.unit === 'length')
      .map((r) => ({
        tool: this.tool,
        kind: r.kind,
        label: r.label,
        value: r.value,
        uncertainty: r.uncertainty,
        toolState: this.serialize(),
      }));
  }

  serialize(): DatumState {
    return structuredClone(this.s);
  }

  render(rc: RenderContext): void {
    const s = this.s;
    const b = this.env.bounds();
    const far = Math.hypot(b.w, b.h);
    drawMarkerLine(rc, s.origin, s.origin, add(s.origin, scale(this.ux(), far)), rc.theme.accent);
    drawMarkerLine(rc, s.origin, s.origin, add(s.origin, scale(this.uy(), far)), rc.theme.accent2);
    drawText(rc, 'X', add(s.origin, scale(this.ux(), 34)), this.uy(), {
      sizeMm: 3,
      color: rc.theme.accent,
      weight: 800,
      halo: rc.theme.bg,
    });
    drawText(rc, 'Y', add(s.origin, scale(this.uy(), 34)), this.uy(), {
      sizeMm: 3,
      color: rc.theme.accent2,
      weight: 800,
      halo: rc.theme.bg,
    });
    if (rc.inLoupe) return;
    s.pts.forEach((p, i) => {
      drawKnob(rc, p, rc.theme.accent2, { active: rc.activeHandleId === `p${i}` });
      drawText(rc, String(i + 1), add(p, [4, -4]), [0, -1], {
        sizeMm: 2.4,
        color: rc.theme.ink,
        halo: rc.theme.bg,
        weight: 700,
      });
    });
    drawKnob(rc, s.origin, '#334155', { active: rc.activeHandleId === 'o' });
    drawKnob(rc, this.axisKnob(), '#64748b', { glyph: 'rotate', active: rc.activeHandleId === 'ax' });
  }
}

export function isDatumState(x: unknown): x is DatumState {
  const o = x as DatumState;
  return !!o && o.tool === 'datumXY' && Array.isArray(o.pts);
}
