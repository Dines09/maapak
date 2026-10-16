// Edge Setup tool (§5.1): four boundary lines, a corner radius and punch-hole exclusion circles.
// Positions are in mm under the stage transform; the screen converts them to CSS px when locking.
import type { Vec } from '../../core/types';
import { dist } from '../../core/geometry';
import type { Handle, Readout, RenderContext, ToolInstance } from '../../render/types';
import { drawKnob, crisp } from '../../render/draw';
import { BaseTool, clamp, newId, type ToolMeasurement } from '../../tools/base';

export interface EdgeState {
  top: number;
  right: number;
  bottom: number;
  left: number;
  corner: number;
  exclusions: { cx: number; cy: number; r: number }[];
  /** Canvas size in mm. */
  W: number;
  H: number;
}

const KNOB_IN = 9;
const MIN_SPAN = 30;

export class EdgeTool extends BaseTool implements ToolInstance {
  readonly id = newId('edges');
  readonly tool = 'calLines' as const;
  label = 'E';
  s: EdgeState;
  private drag: { id: string; p0: Vec; s0: EdgeState } | null = null;

  constructor(s: EdgeState) {
    super();
    this.s = structuredClone(s);
  }

  private knobs(): Record<string, Vec> {
    const s = this.s;
    const cx = (s.left + s.W - s.right) / 2;
    // Upper third: the instruction panel sits in the middle of the screen.
    const cy = s.top + (s.H - s.top - s.bottom) * 0.28;
    const k: Record<string, Vec> = {
      t: [cx, s.top + KNOB_IN],
      b: [cx, s.H - s.bottom - KNOB_IN],
      l: [s.left + KNOB_IN, cy],
      r: [s.W - s.right - KNOB_IN, cy],
      c: [s.left + s.corner * 0.293 + KNOB_IN * 0.8, s.top + s.corner * 0.293 + KNOB_IN * 0.8],
    };
    s.exclusions.forEach((z, i) => {
      k[`x${i}`] = [z.cx, z.cy];
      k[`xr${i}`] = [z.cx + z.r + 5, z.cy];
    });
    return k;
  }

  focusOf(id: string): Vec | null {
    const s = this.s;
    const k = this.knobs();
    if (id === 't') return [k.t[0], s.top];
    if (id === 'b') return [k.b[0], s.H - s.bottom];
    if (id === 'l') return [s.left, k.l[1]];
    if (id === 'r') return [s.W - s.right, k.r[1]];
    if (id === 'c') return [s.left + s.corner * 0.293, s.top + s.corner * 0.293];
    const m = /^xr?(\d+)$/.exec(id);
    if (m) {
      const z = s.exclusions[Number(m[1])];
      return id.startsWith('xr') ? [z.cx + z.r, z.cy] : [z.cx, z.cy];
    }
    return null;
  }

  hitTest(p: Vec, tol: number): Handle | null {
    let best: Handle | null = null;
    let bestD = Infinity;
    for (const [id, pos] of Object.entries(this.knobs())) {
      const d = dist(p, pos);
      if (d <= tol && d < bestD) {
        bestD = d;
        best = { id, kind: 'edge', posMm: pos };
      }
    }
    return best;
  }

  onDragStart(h: Handle, p: Vec): void {
    this.drag = { id: h.id, p0: p, s0: structuredClone(this.s) };
  }

  onDragMove(h: Handle, p: Vec, _precision = false): void {
    const d = this.drag;
    if (!d) return;
    const s = this.s;
    const s0 = d.s0;
    const dx = p[0] - d.p0[0];
    const dy = p[1] - d.p0[1];
    switch (h.id) {
      case 't':
        s.top = clamp(s0.top + dy, 0, s.H - s.bottom - MIN_SPAN);
        break;
      case 'b':
        s.bottom = clamp(s0.bottom - dy, 0, s.H - s.top - MIN_SPAN);
        break;
      case 'l':
        s.left = clamp(s0.left + dx, 0, s.W - s.right - MIN_SPAN);
        break;
      case 'r':
        s.right = clamp(s0.right - dx, 0, s.W - s.left - MIN_SPAN);
        break;
      case 'c':
        s.corner = clamp(s0.corner + (dx + dy) / (2 * 0.293), 0, 25);
        break;
      default: {
        const m = /^(xr?)(\d+)$/.exec(h.id);
        if (!m) return;
        const i = Number(m[2]);
        const z0 = s0.exclusions[i];
        if (m[1] === 'x')
          s.exclusions[i] = { ...z0, cx: clamp(z0.cx + dx, 0, s.W), cy: clamp(z0.cy + dy, 0, s.H) };
        else s.exclusions[i] = { ...z0, r: clamp(z0.r + dx, 1, 15) };
      }
    }
  }

  onDragEnd(_h?: Handle): void {
    this.drag = null;
  }

  readouts(): Readout[] {
    const s = this.s;
    return [
      {
        label: 'A',
        kind: 'area',
        value: (s.W - s.left - s.right) * (s.H - s.top - s.bottom),
        uncertainty: 0,
        unit: 'area',
        primary: true,
      },
    ];
  }

  toMeasurements(): ToolMeasurement[] {
    return [];
  }

  serialize(): EdgeState {
    return structuredClone(this.s);
  }

  render(rc: RenderContext): void {
    const { ctx } = rc;
    const s = this.s;
    const [x0, y0] = rc.mmToPx([s.left, s.top]);
    const [x1, y1] = rc.mmToPx([s.W - s.right, s.H - s.bottom]);
    const [W, H] = rc.mmToPx([s.W, s.H]);
    const [oX, oY] = rc.mmToPx([0, 0]);
    const r = s.corner * rc.pxPerMm;
    // Shade the excluded border.
    ctx.save();
    ctx.fillStyle = 'rgba(244,63,94,0.18)';
    ctx.beginPath();
    ctx.rect(oX, oY, W - oX, H - oY);
    ctx.roundRect(x0, y0, x1 - x0, y1 - y0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
    ctx.fill('evenodd');
    for (const z of s.exclusions) {
      const c = rc.mmToPx([z.cx, z.cy]);
      ctx.beginPath();
      ctx.arc(c[0], c[1], z.r * rc.pxPerMm, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = rc.theme.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(oX, crisp(y0, 1));
    ctx.lineTo(W, crisp(y0, 1));
    ctx.moveTo(oX, crisp(y1, 1));
    ctx.lineTo(W, crisp(y1, 1));
    ctx.moveTo(crisp(x0, 1), oY);
    ctx.lineTo(crisp(x0, 1), H);
    ctx.moveTo(crisp(x1, 1), oY);
    ctx.lineTo(crisp(x1, 1), H);
    ctx.stroke();
    if (r > 0) {
      ctx.setLineDash([4 * rc.dpr, 3 * rc.dpr]);
      ctx.beginPath();
      ctx.roundRect(x0, y0, x1 - x0, y1 - y0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    if (rc.inLoupe) return;
    // Knobs sit inside the area, joined to their line by a short stem, so the finger never covers the line.
    for (const [id, pos] of Object.entries(this.knobs())) {
      const f = this.focusOf(id);
      if (f && (id.length === 1 || id.startsWith('xr'))) {
        const a = rc.mmToPx(f);
        const b = rc.mmToPx(pos);
        ctx.save();
        ctx.strokeStyle = rc.theme.accent;
        ctx.lineWidth = 2 * rc.dpr;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        ctx.restore();
      }
      drawKnob(rc, pos, id === 'c' || id.startsWith('x') ? rc.theme.accent2 : rc.theme.accent, {
        active: rc.activeHandleId === id,
      });
    }
  }
}
