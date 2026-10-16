// Low-level drawing helpers. All coordinates in device px; lengths given in mm go through rc.mmToPx.
import type { Vec } from '../core/types';
import type { RenderContext } from './types';
import { metricTicks, inchTicks, type Tick } from './ticks';
import { add, scale, sub } from '../core/geometry';

/** Crisp lines (§3.6): odd widths on half-pixel offsets, even widths on whole pixels. */
export function crisp(v: number, widthPx: number): number {
  return widthPx % 2 === 1 ? Math.floor(v) + 0.5 : Math.round(v);
}

export function line(ctx: CanvasRenderingContext2D, a: Vec, b: Vec): void {
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
}

export function polygonPx(ctx: CanvasRenderingContext2D, pts: readonly Vec[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
  ctx.closePath();
}

export type ScaleKind = 'mm' | 'cm' | 'inch';

export interface ScaleSpec {
  /** Zero tick on the measuring edge (mm). */
  zero: Vec;
  /** Unit direction of increasing values (mm space). */
  dir: Vec;
  /** Unit vector from the edge into the body (ticks grow this way). */
  normal: Vec;
  /** Visible value range relative to zero (mm). */
  from: number;
  to: number;
  kind: ScaleKind;
  ink: string;
  /** Text up-vector (mm space); labels are kept upright for reading. */
  textUp: Vec;
  inchDen?: 16 | 32 | 64;
}

/** Text rotation so that `up` (mm-space) points up on screen, never upside down. */
export function textAngle(rc: RenderContext, up: Vec): number {
  const o = rc.mmToPx([0, 0]);
  const u = sub(rc.mmToPx(up), o);
  // x-axis of the text = up rotated 90° clockwise on screen.
  let ax = -u[1];
  let ay = u[0];
  if (ax < -1e-6 || (Math.abs(ax) <= 1e-6 && ay > 0)) {
    ax = -ax;
    ay = -ay;
  }
  return Math.atan2(ay, ax);
}

export function fontPx(rc: RenderContext, mm: number, weight = 600): string {
  const px = Math.max(9 * rc.dpr, mm * rc.pxPerMm);
  return `${weight} ${px.toFixed(1)}px ${rc.theme.font}`;
}

export function drawText(
  rc: RenderContext,
  text: string,
  atMm: Vec,
  up: Vec,
  opts: {
    sizeMm?: number;
    color: string;
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
    weight?: number;
    halo?: string;
  },
): void {
  const { ctx } = rc;
  const p = rc.mmToPx(atMm);
  ctx.save();
  ctx.translate(p[0], p[1]);
  ctx.rotate(textAngle(rc, up));
  ctx.font = fontPx(rc, opts.sizeMm ?? 2.6, opts.weight);
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = opts.baseline ?? 'middle';
  if (opts.halo) {
    ctx.lineWidth = 3 * rc.dpr;
    ctx.strokeStyle = opts.halo;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, 0, 0);
  }
  ctx.fillStyle = opts.color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function ticksFor(spec: ScaleSpec, inLoupe: boolean): Tick[] {
  if (spec.kind === 'inch') {
    const den = inLoupe ? 64 : (spec.inchDen ?? 16);
    return inchTicks(spec.from, spec.to, den);
  }
  return metricTicks(spec.from, spec.to, { sub: inLoupe, labelUnit: spec.kind === 'cm' ? 'cm' : 'mm' });
}

/** Draws a graduated scale. Each tick is placed independently: zero + n·step (§3.5). */
export function drawScale(rc: RenderContext, spec: ScaleSpec): void {
  const { ctx } = rc;
  const ticks = ticksFor(spec, rc.inLoupe);
  const zp = rc.mmToPx(spec.zero);
  const dp = sub(rc.mmToPx(add(spec.zero, spec.dir)), zp);
  const axisX = Math.abs(dp[1]) < 1e-9; // horizontal scale on screen → snap x
  const axisY = Math.abs(dp[0]) < 1e-9;
  ctx.save();
  ctx.strokeStyle = spec.ink;
  for (const w of [1, 2] as const) {
    ctx.beginPath();
    ctx.lineWidth = w;
    for (const t of ticks) {
      if (t.widthPx !== w) continue;
      const base = add(spec.zero, scale(spec.dir, t.posMm));
      let a = rc.mmToPx(base);
      let b = rc.mmToPx(add(base, scale(spec.normal, t.lengthMm)));
      if (axisX) {
        const x = crisp(a[0], w);
        a = [x, a[1]];
        b = [x, b[1]];
      } else if (axisY) {
        const y = crisp(a[1], w);
        a = [a[0], y];
        b = [b[0], y];
      }
      line(ctx, a, b);
    }
    ctx.stroke();
  }
  // Labels sit just beyond the longest tick.
  const labelSize = 2.4;
  const every = rc.inLoupe ? 1 : labelStride(rc, spec);
  let k = 0;
  for (const t of ticks) {
    if (!t.label) continue;
    if (k++ % every !== 0) continue;
    const base = add(spec.zero, scale(spec.dir, t.posMm));
    const at = add(base, scale(spec.normal, t.lengthMm + 0.6 + labelSize * 0.6));
    drawText(rc, t.label, at, spec.textUp, { sizeMm: labelSize, color: spec.ink });
  }
  ctx.restore();
}

/** Skip labels when they would overlap (very low resolution screens). */
function labelStride(rc: RenderContext, spec: ScaleSpec): number {
  const spacingMm = spec.kind === 'inch' ? 25.4 : 10;
  const px = spacingMm * rc.pxPerMm;
  const need = 4 * 2.4 * rc.pxPerMm;
  return px >= need ? 1 : Math.ceil(need / px);
}

/** Round knob for a handle. */
export function drawKnob(
  rc: RenderContext,
  atMm: Vec,
  color: string,
  opts: { active?: boolean; glyph?: 'rotate' | 'extend' | 'dot'; ring?: string } = {},
): void {
  const { ctx } = rc;
  const p = rc.mmToPx(atMm);
  const r = (rc.largeHandles ? 15 : 11) * rc.dpr * (opts.active ? 1.15 : 1);
  ctx.save();
  ctx.beginPath();
  ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2 * rc.dpr;
  ctx.strokeStyle = opts.ring ?? '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  if (opts.glyph === 'rotate') {
    ctx.lineWidth = 1.6 * rc.dpr;
    ctx.beginPath();
    ctx.arc(p[0], p[1], r * 0.5, -Math.PI * 0.9, Math.PI * 0.55);
    ctx.stroke();
    const ex = p[0] + r * 0.5 * Math.cos(Math.PI * 0.55);
    const ey = p[1] + r * 0.5 * Math.sin(Math.PI * 0.55);
    ctx.beginPath();
    ctx.moveTo(ex - r * 0.25, ey + r * 0.05);
    ctx.lineTo(ex + r * 0.12, ey - r * 0.25);
    ctx.lineTo(ex + r * 0.22, ey + r * 0.2);
    ctx.fill();
  } else if (opts.glyph === 'extend') {
    ctx.lineWidth = 1.6 * rc.dpr;
    ctx.beginPath();
    ctx.moveTo(p[0] - r * 0.5, p[1]);
    ctx.lineTo(p[0] + r * 0.5, p[1]);
    ctx.moveTo(p[0] - r * 0.25, p[1] - r * 0.28);
    ctx.lineTo(p[0] - r * 0.52, p[1]);
    ctx.lineTo(p[0] - r * 0.25, p[1] + r * 0.28);
    ctx.moveTo(p[0] + r * 0.25, p[1] - r * 0.28);
    ctx.lineTo(p[0] + r * 0.52, p[1]);
    ctx.lineTo(p[0] + r * 0.25, p[1] + r * 0.28);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(p[0], p[1], r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A marker/alignment line: 1 device px exact line plus a faint halo for visibility.
 * Solid from a → mid, dashed from mid → b (sighting extension, §7.8).
 */
export function drawMarkerLine(rc: RenderContext, a: Vec, mid: Vec, b: Vec, color: string): void {
  const { ctx } = rc;
  const pa = rc.mmToPx(a);
  const pm = rc.mmToPx(mid);
  const pb = rc.mmToPx(b);
  const horiz = Math.abs(pa[1] - pb[1]) < 1e-6;
  const vert = Math.abs(pa[0] - pb[0]) < 1e-6;
  const fix = (p: Vec): Vec => (vert ? [crisp(p[0], 1), p[1]] : horiz ? [p[0], crisp(p[1], 1)] : p);
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 5 * rc.dpr;
  ctx.beginPath();
  line(ctx, pa, pm);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.beginPath();
  line(ctx, fix(pa), fix(pm));
  ctx.stroke();
  ctx.setLineDash([4 * rc.dpr, 3 * rc.dpr]);
  ctx.beginPath();
  line(ctx, fix(pm), fix(pb));
  ctx.stroke();
  ctx.restore();
}

/** Small rounded label (on-canvas value tag). */
export function drawTag(rc: RenderContext, text: string, atMm: Vec, up: Vec, bg: string, fg: string): void {
  const { ctx } = rc;
  const p = rc.mmToPx(atMm);
  ctx.save();
  ctx.translate(p[0], p[1]);
  ctx.rotate(textAngle(rc, up));
  ctx.font = fontPx(rc, 2.4, 700);
  const w = ctx.measureText(text).width + 8 * rc.dpr;
  const h = Math.max(16 * rc.dpr, 3.6 * rc.pxPerMm);
  ctx.fillStyle = bg;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
