// Two parallel alignment lines used by calibration and verification (§5.2). Lines are perpendicular to one
// screen axis; their separation is read in DEVICE px, independent of any calibration.
import type { Vec } from '../../core/types';
import { dist } from '../../core/geometry';
import type { Handle, Readout, RenderContext, ToolInstance } from '../../render/types';
import { drawKnob, drawMarkerLine } from '../../render/draw';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../base';

export interface CalLinesState {
  v: 1;
  id: string;
  axis: 'x' | 'y';
  /** Line positions along the axis (mm under the provisional transform). */
  p1: number;
  p2: number;
  fixed1: boolean;
  /** Extent of the lines along the other axis (mm). */
  span: [number, number];
  /** Knob position along the line for each line (mm, other axis). */
  knob1: number;
  knob2: number;
}

export function calLines(
  init: Partial<CalLinesState> & Pick<CalLinesState, 'axis' | 'p1' | 'p2' | 'span'>,
): CalLinesState {
  return { v: 1, id: newId('cal'), fixed1: false, knob1: init.span[1], knob2: init.span[1], ...init };
}

export class CalLinesTool extends BaseTool implements ToolInstance {
  readonly id: string;
  readonly tool = 'calLines' as const;
  label = 'C';
  s: CalLinesState;
  private drag: { id: string; p0: Vec; v0: number } | null = null;

  constructor(s: CalLinesState) {
    super();
    this.s = structuredClone(s);
    this.id = s.id;
  }

  private pt(pos: number, along: number): Vec {
    return this.s.axis === 'x' ? [pos, along] : [along, pos];
  }

  /** Separation in device px along the axis. */
  devicePx(): number {
    const t = this.env.transform();
    return Math.abs(this.s.p2 - this.s.p1) * (this.s.axis === 'x' ? t.sx : t.sy);
  }

  /** Separation in mm under the active transform. */
  mm(): number {
    return Math.abs(this.s.p2 - this.s.p1);
  }

  focusOf(id: string): Vec | null {
    if (id === '1') return this.pt(this.s.p1, (this.s.span[0] + this.s.span[1]) / 2);
    if (id === '2') return this.pt(this.s.p2, (this.s.span[0] + this.s.span[1]) / 2);
    return null;
  }

  hitTest(p: Vec, tol: number): Handle | null {
    const s = this.s;
    const k2 = this.pt(s.p2, s.knob2);
    if (dist(p, k2) <= tol) return { id: '2', kind: 'edge', posMm: k2 };
    if (!s.fixed1) {
      const k1 = this.pt(s.p1, s.knob1);
      if (dist(p, k1) <= tol) return { id: '1', kind: 'edge', posMm: k1 };
    }
    return null;
  }

  onDragStart(h: Handle, p: Vec): void {
    this.drag = { id: h.id, p0: p, v0: h.id === '1' ? this.s.p1 : this.s.p2 };
  }

  onDragMove(h: Handle, p: Vec, _precision = false): void {
    if (!this.drag) return;
    const i = this.s.axis === 'x' ? 0 : 1;
    const b = this.env.bounds();
    const lo = i === 0 ? b.x : b.y;
    const hi = i === 0 ? b.x + b.w : b.y + b.h;
    const v = clamp(this.drag.v0 + (p[i] - this.drag.p0[i]), lo, hi);
    if (h.id === '1') this.s.p1 = v;
    else this.s.p2 = v;
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  readouts(): Readout[] {
    return [{ label: 'C', kind: 'length', value: this.mm(), uncertainty: 0, primary: true, unit: 'length' }];
  }

  toMeasurements(): ToolMeasurement[] {
    return [];
  }

  serialize(): CalLinesState {
    return structuredClone(this.s);
  }

  render(rc: RenderContext): void {
    const s = this.s;
    const ext = 6;
    const lines: [number, number, string, boolean][] = [
      [s.p1, s.knob1, s.fixed1 ? rc.theme.ink : rc.theme.accent, s.fixed1],
      [s.p2, s.knob2, rc.theme.accent2, false],
    ];
    for (const [pos, knob, color, fixed] of lines) {
      const a = this.pt(pos, s.span[0] - ext);
      const b = this.pt(pos, s.span[1] + ext);
      drawMarkerLine(rc, a, b, b, color);
      if (!fixed && !rc.inLoupe)
        drawKnob(rc, this.pt(pos, knob), color, { active: rc.activeHandleId === (pos === s.p1 ? '1' : '2') });
    }
  }
}
