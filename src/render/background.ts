// Backgrounds and patterns (§8), drawn in mm so patterns are true scale.
import type { RenderContext } from './types';
import type { RectMm } from '../core/geometry';
import { inkFor, mostContrasting, blend } from '../core/color';

export type BgPattern = 'none' | 'grid' | 'stripes';

export interface BackgroundSpec {
  color: string;
  pattern: BgPattern;
  /** Light-table (silhouette) mode: white + max-brightness tip. */
  lightTable?: boolean;
}

export interface BgPreset {
  id: string;
  labelKey: string;
  spec: BackgroundSpec;
}

export const BG_PRESETS: BgPreset[] = [
  { id: 'white', labelKey: 'bg.white', spec: { color: '#ffffff', pattern: 'none' } },
  { id: 'black', labelKey: 'bg.black', spec: { color: '#000000', pattern: 'none' } },
  { id: 'grey', labelKey: 'bg.grey', spec: { color: '#808080', pattern: 'none' } },
  { id: 'green', labelKey: 'bg.green', spec: { color: '#00b140', pattern: 'none' } },
  { id: 'blue', labelKey: 'bg.blue', spec: { color: '#0047ab', pattern: 'none' } },
  { id: 'yellow', labelKey: 'bg.yellow', spec: { color: '#ffd400', pattern: 'none' } },
  { id: 'grid', labelKey: 'bg.grid', spec: { color: '#ffffff', pattern: 'grid' } },
  { id: 'stripes', labelKey: 'bg.stripes', spec: { color: '#ffffff', pattern: 'stripes' } },
];

/** Solid candidates for auto-contrast. */
export const SOLID_BG_COLORS = BG_PRESETS.filter((p) => p.spec.pattern === 'none').map((p) => p.spec.color);

/** Okabe–Ito colour-blind-safe palette. */
export const CB_PALETTE = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#F0E442'];

export function accentsFor(bg: string): [string, string] {
  const a = mostContrasting(bg, CB_PALETTE);
  const b = mostContrasting(
    bg,
    CB_PALETTE.filter((c) => c !== a),
  );
  return [a, b];
}

export function patternInk(bg: string): string {
  // Faint pattern lines: 25% of the ink colour over the background.
  return blend(inkFor(bg), bg, 0.22);
}

export function drawBackground(rc: RenderContext, area: RectMm, spec: BackgroundSpec): void {
  const { ctx } = rc;
  ctx.fillStyle = spec.color;
  const [x0, y0] = rc.mmToPx([area.x, area.y]);
  const [x1, y1] = rc.mmToPx([area.x + area.w, area.y + area.h]);
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  if (spec.pattern === 'none') return;
  ctx.save();
  ctx.strokeStyle = patternInk(spec.color);
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (spec.pattern === 'grid') {
    const step = rc.inLoupe ? 1 : 5;
    const i0 = Math.floor(area.x / step);
    const i1 = Math.ceil((area.x + area.w) / step);
    for (let i = i0; i <= i1; i++) {
      const [x] = rc.mmToPx([i * step, 0]);
      const cx = Math.round(x) + 0.5;
      ctx.moveTo(cx, y0);
      ctx.lineTo(cx, y1);
    }
    const j0 = Math.floor(area.y / step);
    const j1 = Math.ceil((area.y + area.h) / step);
    for (let j = j0; j <= j1; j++) {
      const [, y] = rc.mmToPx([0, j * step]);
      const cy = Math.round(y) + 0.5;
      ctx.moveTo(x0, cy);
      ctx.lineTo(x1, cy);
    }
  } else {
    // 45° stripes every 3 mm.
    const step = 3;
    const span = area.w + area.h;
    for (let k = -Math.ceil(span / step); k <= Math.ceil(span / step); k++) {
      const c = area.x + area.y + k * step;
      const a = rc.mmToPx([c - area.y - area.h, area.y + area.h]);
      const b = rc.mmToPx([c - area.y, area.y]);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.lineWidth = Math.max(1, rc.pxPerMm * 0.6);
  }
  ctx.stroke();
  ctx.restore();
}
