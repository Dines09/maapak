// Template / Match mode (§7.9): a saved record's outline at true 1:1 scale with a ± tolerance band. Lay the
// new part on it: every edge inside the band = match.
import type { Vec } from '../../core/types';
import {
  add,
  dirOf,
  dist,
  fitShift,
  normAngle,
  rad2deg,
  rotateAbout,
  scale,
  snapAngle,
  sub,
  type RectMm,
} from '../../core/geometry';
import type { Entity, Handle, Readout, RenderContext, ToolInstance, ToolPreset } from '../../render/types';
import { circlePoints, drawKnob, pathMm } from '../../render/draw';
import { BaseTool, newId, type ToolMeasurement } from '../base';

export interface TemplateState {
  v: 1;
  id: string;
  tool: 'template';
  n: number;
  placed: boolean;
  name: string;
  outline: Entity[];
  c: Vec;
  angle: number;
  /** ± tolerance (mm). */
  tol: number;
}

export function defaultTemplateState(outline: Entity[] = [], name = ''): TemplateState {
  return {
    v: 1,
    id: newId('tpl'),
    tool: 'template',
    n: 1,
    placed: false,
    name,
    outline,
    c: [0, 0],
    angle: 0,
    tol: 0.5,
  };
}

/** Entity → mm polylines in the part frame. */
function entityPaths(e: Entity): { pts: Vec[]; closed: boolean }[] {
  switch (e.type) {
    case 'line':
      return [{ pts: [e.a, e.b], closed: false }];
    case 'polyline':
      return [{ pts: e.points, closed: e.closed }];
    case 'circle':
      return [{ pts: circlePoints(e.center, e.r, 144), closed: true }];
    case 'arc': {
      const k = 48;
      let a1 = e.a1;
      while (a1 < e.a0) a1 += 360;
      return [
        {
          pts: Array.from({ length: k + 1 }, (_, i) =>
            add(e.center, scale(dirOf(e.a0 + ((a1 - e.a0) * i) / k), e.r)),
          ),
          closed: false,
        },
      ];
    }
  }
}

export class TemplateTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool = 'template' as const;
  label = 'TPL';
  s: TemplateState;
  private drag: { id: string; p0: Vec; s0: TemplateState; snapped: number | null } | null = null;

  constructor(state: TemplateState) {
    super();
    this.s = structuredClone(state);
    this.id = state.id;
  }

  private paths(): { pts: Vec[]; closed: boolean }[] {
    const s = this.s;
    return s.outline
      .filter((e) => e.style !== 'centre' && e.style !== 'hidden')
      .flatMap(entityPaths)
      .map((p) => ({ ...p, pts: p.pts.map((q) => add(s.c, rotateAbout(q, [0, 0], s.angle))) }));
  }

  private extent(): number {
    let r = 5;
    for (const p of this.paths()) for (const q of p.pts) r = Math.max(r, dist(q, this.s.c));
    return r;
  }

  attach(env: Parameters<BaseTool['attach']>[0]): void {
    super.attach(env);
    if (this.s.placed) return;
    const b = env.placeBounds();
    this.s.c = [b.x + b.w / 2, b.y + b.h / 2];
    this.s.placed = true;
  }

  outline(): Vec[] {
    return this.paths().flatMap((p) => p.pts);
  }

  fit(b: RectMm): void {
    const pts = this.outline();
    if (pts.length) this.s.c = add(this.s.c, fitShift(pts, b));
  }

  rotateBy(deg: number, pivot: Vec): void {
    this.s.c = rotateAbout(this.s.c, pivot, deg);
    this.s.angle = normAngle(this.s.angle + deg);
  }

  angle(): number {
    return this.s.angle;
  }

  spotlight(): Vec[][] {
    return this.paths()
      .filter((p) => p.closed)
      .map((p) => p.pts);
  }

  private rotKnob(): Vec {
    return add(this.s.c, scale(dirOf(this.s.angle - 90), this.extent() + 6));
  }

  /** Drag from anywhere around the template moves it (the part sits on top). */
  indirect(p: Vec): Handle {
    return { id: 'ind:c', kind: 'point', posMm: p };
  }

  focusOf(id: string): Vec | null {
    return id === 'rot' ? this.rotKnob() : id === 'c' ? this.s.c : null;
  }

  hitTest(p: Vec, tol: number): Handle | null {
    if (dist(p, this.rotKnob()) <= tol) return { id: 'rot', kind: 'rotate', posMm: this.rotKnob() };
    if (dist(p, this.s.c) <= tol) return { id: 'c', kind: 'point', posMm: this.s.c };
    return null;
  }

  onDragStart(h: Handle, p: Vec): void {
    this.drag = { id: h.id, p0: p, s0: structuredClone(this.s), snapped: null };
  }

  onDragMove(h: Handle, p: Vec): void {
    const d = this.drag;
    if (!d) return;
    if (h.id === 'rot') {
      let a = normAngle(rad2deg(Math.atan2(p[1] - d.s0.c[1], p[0] - d.s0.c[0])) + 90);
      if (this.env.angleSnap()) {
        const [sa, ok] = snapAngle(a, 90, 2);
        if (ok) {
          if (d.snapped !== sa) this.snapHaptic();
          d.snapped = sa;
          a = sa;
        } else d.snapped = null;
      }
      this.s.angle = a;
    } else this.s.c = add(d.s0.c, sub(p, d.p0));
  }

  onDragEnd(): void {
    this.drag = null;
  }

  presets(): ToolPreset[] {
    return [0.1, 0.2, 0.5, 1, 2].map((t) => ({
      id: `t${t}`,
      label: `±${t}`,
      active: Math.abs(this.s.tol - t) < 1e-6,
      run: () => (this.s.tol = t),
    }));
  }

  readouts(): Readout[] {
    return [
      {
        label: this.s.name || 'TPL',
        kind: 'length',
        value: this.s.tol,
        uncertainty: 0,
        primary: true,
        unit: 'length',
        nameKey: 'template.band',
        notes: [`${this.s.name} · 1:1`],
      },
    ];
  }

  toMeasurements(): ToolMeasurement[] {
    return [];
  }

  serialize(): TemplateState {
    return structuredClone(this.s);
  }

  render(rc: RenderContext): void {
    const { ctx } = rc;
    const paths = this.paths();
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Tolerance band (2·tol wide) then the exact outline as a 1-device-px line.
    ctx.strokeStyle = 'rgba(16,185,129,0.35)';
    ctx.lineWidth = Math.max(2, 2 * this.s.tol * rc.pxPerMm);
    for (const p of paths) {
      pathMm(rc, p.pts, p.closed);
      ctx.stroke();
    }
    ctx.strokeStyle = rc.theme.accent;
    ctx.lineWidth = 1;
    for (const p of paths) {
      pathMm(rc, p.pts, p.closed);
      ctx.stroke();
    }
    ctx.restore();
    if (rc.inLoupe) return;
    drawKnob(rc, this.s.c, '#334155', { active: rc.activeHandleId === 'c' });
    drawKnob(rc, this.rotKnob(), '#64748b', { glyph: 'rotate', active: rc.activeHandleId === 'rot' });
  }
}

export function isTemplateState(x: unknown): x is TemplateState {
  const o = x as TemplateState;
  return !!o && o.tool === 'template' && Array.isArray(o.outline);
}
