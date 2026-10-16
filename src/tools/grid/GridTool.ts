// Grid paper (§6.8.4): true-scale 1 / 5 / 10 mm or 1/8″ / 1/4″ grids for quick sizing and outlining.
import type { Vec } from '../../core/types';
import { add, sub, type RectMm } from '../../core/geometry';
import { MM_PER_INCH } from '../../core/units';
import type { Handle, Readout, RenderContext, ToolInstance, ToolPreset } from '../../render/types';
import { drawCross } from '../../render/draw';
import { BaseTool, newId, type ToolMeasurement } from '../base';

export interface GridState {
  v: 1;
  id: string;
  tool: 'grid';
  n: number;
  placed: boolean;
  origin: Vec;
  /** Spacing in mm. */
  step: number;
}

export function defaultGridState(n = 1): GridState {
  return { v: 1, id: newId('grid'), tool: 'grid', n, placed: false, origin: [0, 0], step: 5 };
}

const STEPS: [string, number][] = [
  ['1 mm', 1],
  ['5 mm', 5],
  ['10 mm', 10],
  ['1/8″', MM_PER_INCH / 8],
  ['1/4″', MM_PER_INCH / 4],
];

export class GridTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool = 'grid' as const;
  label = 'G';
  s: GridState;
  private drag: { p0: Vec; o0: Vec } | null = null;

  constructor(state: GridState) {
    super();
    this.s = structuredClone(state);
    this.id = state.id;
  }

  attach(env: Parameters<BaseTool['attach']>[0]): void {
    super.attach(env);
    if (this.s.placed) return;
    const b = env.placeBounds();
    this.s.origin = [b.x + 4, b.y + 4];
    this.s.placed = true;
  }

  fit(_b: RectMm): void {
    /* infinite grid */
  }

  hitTest(p: Vec, tol: number): Handle | null {
    return Math.hypot(p[0] - this.s.origin[0], p[1] - this.s.origin[1]) <= tol
      ? { id: 'o', kind: 'point', posMm: this.s.origin }
      : null;
  }

  /** Drag anywhere to move the grid origin (the grid itself never covers a part's edge). */
  indirect(p: Vec): Handle {
    return { id: 'ind:o', kind: 'point', posMm: p };
  }

  onDragStart(_h: Handle, p: Vec): void {
    this.drag = { p0: p, o0: this.s.origin };
  }

  onDragMove(_h: Handle, p: Vec): void {
    if (this.drag) this.s.origin = add(this.drag.o0, sub(p, this.drag.p0));
  }

  onDragEnd(): void {
    this.drag = null;
  }

  presets(): ToolPreset[] {
    return STEPS.map(([label, step]) => ({
      id: label,
      label,
      active: Math.abs(this.s.step - step) < 1e-6,
      run: () => (this.s.step = step),
    }));
  }

  readouts(): Readout[] {
    return [
      {
        label: 'G',
        kind: 'length',
        value: this.s.step,
        uncertainty: 0,
        primary: true,
        unit: 'length',
        nameKey: 'grid.spacing',
      },
    ];
  }

  toMeasurements(): ToolMeasurement[] {
    return [];
  }

  serialize(): GridState {
    return structuredClone(this.s);
  }

  render(rc: RenderContext): void {
    const { ctx } = rc;
    const b = this.env.bounds();
    const st = this.s.step;
    const [ox, oy] = this.s.origin;
    const i0 = Math.ceil((b.x - ox) / st);
    const i1 = Math.floor((b.x + b.w - ox) / st);
    const j0 = Math.ceil((b.y - oy) / st);
    const j1 = Math.floor((b.y + b.h - oy) / st);
    const major = st < 2 ? 10 : st >= 6 ? 1 : 2;
    for (const heavy of [false, true]) {
      ctx.save();
      ctx.strokeStyle = rc.theme.ink;
      ctx.globalAlpha = heavy ? 0.55 : 0.22;
      ctx.lineWidth = heavy ? 1.5 : 1;
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        if ((i % major === 0) !== heavy) continue;
        const a = rc.mmToPx([ox + i * st, b.y]);
        const c = rc.mmToPx([ox + i * st, b.y + b.h]);
        const x = Math.round(a[0]) + 0.5;
        ctx.moveTo(x, a[1]);
        ctx.lineTo(x, c[1]);
      }
      for (let j = j0; j <= j1; j++) {
        if ((j % major === 0) !== heavy) continue;
        const a = rc.mmToPx([b.x, oy + j * st]);
        const c = rc.mmToPx([b.x + b.w, oy + j * st]);
        const y = Math.round(a[1]) + 0.5;
        ctx.moveTo(a[0], y);
        ctx.lineTo(c[0], y);
      }
      ctx.stroke();
      ctx.restore();
    }
    drawCross(rc, this.s.origin, rc.theme.accent, 3);
  }
}

export function isGridState(x: unknown): x is GridState {
  const o = x as GridState;
  return !!o && o.tool === 'grid' && typeof o.step === 'number';
}
