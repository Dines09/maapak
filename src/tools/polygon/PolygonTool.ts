// Polyline / polygon (§6.7): vertices → segment lengths, total length, interior angles and closed area
// (shoelace). Vertices are added from the toolbar (touches on empty canvas are ignored by the shield).
import type { Vec } from '../../core/types';
import { add, dist, distToSegment, scale, sub, type RectMm } from '../../core/geometry';
import { interiorAngles, pathLength, pointInPolygon, polygonArea } from '../../core/geometry/fit';
import { angleUncertaintyDeg, roundUpOneSig } from '../../core/uncertainty';
import type { Handle, Readout, RenderContext, ToolAction, ToolInstance } from '../../render/types';
import { drawKnob, drawOutline, drawTag } from '../../render/draw';
import { fmtArea, fmtLength, unitLabel } from '../../render/format';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../base';
import { ghostFrom, linear } from '../drawing';
import type { DrawingEntities, GhostShape } from '../../render/types';

export interface PolygonState {
  v: 1;
  id: string;
  tool: 'polygon';
  n: number;
  placed: boolean;
  pts: Vec[];
  closed: boolean;
}

export function defaultPolygonState(n = 1): PolygonState {
  return { v: 1, id: newId('poly'), tool: 'polygon', n, placed: false, pts: [], closed: true };
}

export class PolygonTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool = 'polygon' as const;
  s: PolygonState;
  private drag: { id: string; p0: Vec; s0: PolygonState } | null = null;

  constructor(state: PolygonState) {
    super();
    this.s = structuredClone(state);
    this.id = state.id;
  }

  get label(): string {
    return `AR${this.s.n}`;
  }
  set label(v: string) {
    const m = /(\d+)$/.exec(v);
    if (m) this.s.n = Number(m[1]);
  }

  attach(env: Parameters<BaseTool['attach']>[0]): void {
    super.attach(env);
    if (this.s.placed) return;
    const b = env.placeBounds();
    const c: Vec = [b.x + b.w / 2, b.y + b.h / 2];
    const w = clamp(b.w * 0.3, 10, 30);
    const h = clamp(b.h * 0.2, 8, 22);
    this.s.pts = [
      [c[0] - w, c[1] - h],
      [c[0] + w, c[1] - h],
      [c[0] + w, c[1] + h],
      [c[0] - w, c[1] + h],
    ];
    this.s.placed = true;
  }

  outline(): Vec[] {
    return [...this.s.pts];
  }

  fit(b: RectMm): void {
    this.s.pts = this.s.pts.map((p) => [clamp(p[0], b.x, b.x + b.w), clamp(p[1], b.y, b.y + b.h)] as Vec);
  }

  rotateBy(): void {
    /* vertices are placed individually */
  }

  spotlight(): Vec[][] | null {
    return this.s.closed && this.s.pts.length >= 3 ? [this.s.pts] : null;
  }

  snapTargets(): Vec[] {
    return [...this.s.pts];
  }

  focusOf(id: string): Vec | null {
    const m = /^v(\d+)$/.exec(id);
    return m ? this.s.pts[Number(m[1])] : null;
  }

  hitTest(p: Vec, tol: number): Handle | null {
    const s = this.s;
    let best: Handle | null = null;
    let bd = Infinity;
    s.pts.forEach((q, i) => {
      const d = dist(p, q);
      if (d <= tol && d < bd) {
        bd = d;
        best = { id: `v${i}`, kind: 'point', posMm: q };
      }
    });
    if (best) return best;
    if (s.closed && s.pts.length >= 3 && pointInPolygon(p, s.pts))
      return { id: 'body', kind: 'body', posMm: p };
    const n = s.closed ? s.pts.length : s.pts.length - 1;
    for (let i = 0; i < n; i++) {
      if (distToSegment(p, s.pts[i], s.pts[(i + 1) % s.pts.length]) <= tol * 0.4)
        return { id: 'body', kind: 'body', posMm: p };
    }
    return null;
  }

  onDragStart(h: Handle, p: Vec): void {
    this.drag = { id: h.id, p0: p, s0: structuredClone(this.s) };
  }

  onDragMove(h: Handle, p: Vec, _precision = false): void {
    const d = this.drag;
    if (!d) return;
    const delta = sub(p, d.p0);
    const m = /^v(\d+)$/.exec(h.id);
    if (m) {
      const i = Number(m[1]);
      this.s.pts[i] = add(d.s0.pts[i], delta);
    } else this.s.pts = d.s0.pts.map((q) => add(q, delta));
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  /** Insert a vertex in the middle of the longest segment. */
  addVertex(): void {
    const s = this.s;
    const n = s.closed ? s.pts.length : s.pts.length - 1;
    let best = 0;
    let bl = -1;
    for (let i = 0; i < n; i++) {
      const l = dist(s.pts[i], s.pts[(i + 1) % s.pts.length]);
      if (l > bl) {
        bl = l;
        best = i;
      }
    }
    const a = s.pts[best];
    const b = s.pts[(best + 1) % s.pts.length];
    s.pts.splice(best + 1, 0, scale(add(a, b), 0.5));
  }

  actions(): ToolAction[] {
    const s = this.s;
    return [
      { id: 'add', labelKey: 'polygon.add', run: () => this.addVertex() },
      {
        id: 'remove',
        labelKey: 'polygon.remove',
        run: () => {
          if (s.pts.length > (s.closed ? 3 : 2)) s.pts.pop();
        },
      },
      {
        id: 'closed',
        labelKey: 'polygon.closed',
        active: s.closed,
        run: () => (s.closed = !s.closed && s.pts.length >= 3),
      },
    ];
  }

  readouts(): Readout[] {
    const s = this.s;
    const u = this.env.pointU();
    const rc = this.env.relCal();
    const segs: number[] = [];
    const n = s.closed ? s.pts.length : s.pts.length - 1;
    for (let i = 0; i < n; i++) segs.push(dist(s.pts[i], s.pts[(i + 1) % s.pts.length]));
    const total = pathLength(s.pts, s.closed);
    const UP = roundUpOneSig(2 * Math.sqrt(2 * s.pts.length * u * u + (total * rc) ** 2));
    const out: Readout[] = [];
    if (s.closed && s.pts.length >= 3) {
      const A = polygonArea(s.pts);
      let sum = 0;
      for (let i = 0; i < s.pts.length; i++) {
        const prev = segs[(i - 1 + segs.length) % segs.length];
        sum += ((prev + segs[i]) / 2) ** 2;
      }
      const UA = roundUpOneSig(2 * Math.sqrt(sum * u * u + (2 * A * rc) ** 2));
      out.push({
        label: `AR${s.n}`,
        kind: 'area',
        value: A,
        uncertainty: UA,
        primary: true,
        unit: 'area',
        nameKey: 'readout.area',
      });
      out.push({
        label: `PE${s.n}`,
        kind: 'perimeter',
        value: total,
        uncertainty: UP,
        unit: 'length',
        nameKey: 'kind.perimeter',
      });
    } else {
      out.push({
        label: `L${s.n}`,
        kind: 'length',
        value: total,
        uncertainty: UP,
        primary: true,
        unit: 'length',
        nameKey: 'readout.total',
      });
    }
    segs.slice(0, 8).forEach((l, i) => {
      const a = s.pts[i];
      const b = s.pts[(i + 1) % s.pts.length];
      out.push({
        label: `S${i + 1}`,
        kind: 'length',
        value: l,
        uncertainty: this.env.uncertainty(l, sub(b, a), 2),
        unit: 'length',
        nameKey: undefined,
      });
    });
    if (s.closed && s.pts.length >= 3) {
      const angs = interiorAngles(s.pts);
      angs.slice(0, 8).forEach((a, i) => {
        const prev = segs[(i - 1 + segs.length) % segs.length];
        out.push({
          label: `∠${i + 1}`,
          kind: 'angle',
          value: a,
          uncertainty: angleUncertaintyDeg(u, [prev, segs[i]]),
          unit: 'angle',
        });
      });
    }
    return out;
  }

  toMeasurements(): ToolMeasurement[] {
    const rs = this.readouts();
    return rs
      .filter((r) => r.primary || r.kind === 'perimeter')
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
    const c = scale(
      s.pts.reduce((a, p) => add(a, p), [0, 0] as Vec),
      1 / Math.max(1, s.pts.length),
    );
    const pts = s.pts.map((p) => sub(p, c));
    const n = s.closed ? pts.length : pts.length - 1;
    const dims = [];
    for (let i = 0; i < Math.min(n, 8); i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      dims.push(linear('length', `S${i + 1}`, dist(a, b), 0, a, b, -6));
    }
    return { views: { top: { outline: [{ type: 'polyline', points: pts, closed: s.closed }], dims } } };
  }

  toGhost(): GhostShape | null {
    const s = this.s;
    if (s.pts.length < 2) return null;
    const c = scale(
      s.pts.reduce((a, p) => add(a, p), [0, 0] as Vec),
      1 / s.pts.length,
    );
    return ghostFrom([{ kind: 'polyline', points: s.pts.map((p) => sub(p, c)), closed: s.closed }]);
  }

  serialize(): PolygonState {
    return structuredClone(this.s);
  }

  render(rc: RenderContext): void {
    const s = this.s;
    drawOutline(rc, s.pts, s.closed, rc.theme.accent, s.closed ? 'rgba(14,165,233,0.08)' : undefined);
    if (rc.inLoupe) return;
    const rs = this.readouts();
    const c = scale(
      s.pts.reduce((a, p) => add(a, p), [0, 0] as Vec),
      1 / Math.max(1, s.pts.length),
    );
    const r = rs[0];
    const val =
      r.unit === 'area'
        ? `${fmtArea(r.value, r.uncertainty, rc.unit)} ${unitLabel(rc.unit)}²`
        : fmtLength(r.value, r.uncertainty, rc.unit, rc.fractionDen);
    drawTag(rc, `${r.label} ${val}`, c, [0, -1], rc.theme.ink, rc.theme.bg);
    s.pts.forEach((p, i) =>
      drawKnob(rc, p, i === 0 ? rc.theme.accent2 : rc.theme.accent, {
        active: rc.activeHandleId === `v${i}`,
      }),
    );
  }
}

export function isPolygonState(x: unknown): x is PolygonState {
  const o = x as PolygonState;
  return !!o && o.tool === 'polygon' && Array.isArray(o.pts);
}
