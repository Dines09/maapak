// Engineering drawing as SVG, in mm user units (§11): thin dimension and extension lines, extension lines
// with a small gap and 2 mm overshoot, filled 3:1 arrowheads, text above the dimension line, Ø / R / °
// symbols, first-angle projection by default. Linear dimensions on the same side are stacked.
import type { Vec } from '../../core/types';
import {
  formatNumber,
  fromMm,
  toFraction,
  formatFraction,
  type FractionDenominator,
  type LengthUnit,
} from '../../core/units';
import { decimalsFor } from '../../core/uncertainty';
import type { DimSpec, DrawingView, Entity } from '../../render/types';
import type { RecordView } from './model';

export interface SvgOptions {
  unit: LengthUnit;
  den: FractionDenominator;
  /** Text height (mm). ISO default 3.5. */
  textMm?: number;
  color?: string;
  dimColor?: string;
  /** Draw part outlines (false for photo overlays where the photo shows the part). */
  outlines?: boolean;
  /** White halo behind text (for photos). */
  halo?: boolean;
  lineScale?: number;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

/** Value text with honest decimals; U = 0 (no uncertainty known) falls back to 1 decimal in mm. */
export function dimText(d: DimSpec, unit: LengthUnit, den: FractionDenominator): string {
  if (d.type === 'angle') {
    const dec = d.uncertainty > 0 ? Math.min(1, Math.max(0, -Math.floor(Math.log10(d.uncertainty)))) : 1;
    return `${formatNumber(d.value, dec)}°`;
  }
  const u = unit === 'in-frac' ? 'in' : unit;
  let v: string;
  if (unit === 'in-frac') v = formatFraction(toFraction(d.value, den));
  else {
    const dec = d.uncertainty > 0 ? decimalsFor(d.uncertainty, u) : u === 'mm' ? 1 : u === 'cm' ? 2 : 3;
    v = formatNumber(fromMm(d.value, u), dec);
  }
  if (d.type === 'diameter') return `Ø${v}`;
  if (d.type === 'radius') return `R${v}`;
  if (d.kind === 'acrossFlats') return `${v} AF`;
  return v;
}

function arrow(tip: Vec, dir: Vec, len: number): string {
  // Filled 3:1 arrowhead pointing along dir, tip at `tip`.
  const w = len / 6;
  const bx = tip[0] - dir[0] * len;
  const by = tip[1] - dir[1] * len;
  return `<path d="M${f(tip[0])} ${f(tip[1])} L${f(bx - dir[1] * w)} ${f(by + dir[0] * w)} L${f(bx + dir[1] * w)} ${f(by - dir[0] * w)} Z" class="ah"/>`;
}

function textAt(p: Vec, angleDeg: number, s: string, size: number): string {
  let a = angleDeg;
  if (a > 90 || a <= -90) a += 180; // keep readable
  return `<text x="${f(p[0])}" y="${f(p[1])}" font-size="${f(size)}" text-anchor="middle" dominant-baseline="auto" transform="rotate(${f(a)} ${f(p[0])} ${f(p[1])})">${esc(s)}</text>`;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const grow = (b: Box, p: Vec, pad = 0) => {
  b.x0 = Math.min(b.x0, p[0] - pad);
  b.y0 = Math.min(b.y0, p[1] - pad);
  b.x1 = Math.max(b.x1, p[0] + pad);
  b.y1 = Math.max(b.y1, p[1] + pad);
};

function entitySvg(e: Entity, box: Box): string {
  const cls = e.style === 'centre' ? 'cl' : e.style === 'hidden' ? 'hl' : 'ol';
  switch (e.type) {
    case 'line':
      grow(box, e.a);
      grow(box, e.b);
      return `<line x1="${f(e.a[0])}" y1="${f(e.a[1])}" x2="${f(e.b[0])}" y2="${f(e.b[1])}" class="${cls}"/>`;
    case 'polyline':
      e.points.forEach((p) => grow(box, p));
      return `<${e.closed ? 'polygon' : 'polyline'} points="${e.points.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')}" class="${cls}" fill="none"/>`;
    case 'circle':
      grow(box, [e.center[0] - e.r, e.center[1] - e.r]);
      grow(box, [e.center[0] + e.r, e.center[1] + e.r]);
      return `<circle cx="${f(e.center[0])}" cy="${f(e.center[1])}" r="${f(e.r)}" class="${cls}" fill="none"/>`;
    case 'arc': {
      const p0: Vec = [
        e.center[0] + e.r * Math.cos((e.a0 * Math.PI) / 180),
        e.center[1] + e.r * Math.sin((e.a0 * Math.PI) / 180),
      ];
      const p1: Vec = [
        e.center[0] + e.r * Math.cos((e.a1 * Math.PI) / 180),
        e.center[1] + e.r * Math.sin((e.a1 * Math.PI) / 180),
      ];
      grow(box, p0);
      grow(box, p1);
      const large = Math.abs(e.a1 - e.a0) > 180 ? 1 : 0;
      return `<path d="M${f(p0[0])} ${f(p0[1])} A${f(e.r)} ${f(e.r)} 0 ${large} 1 ${f(p1[0])} ${f(p1[1])}" class="${cls}" fill="none"/>`;
    }
  }
}

/** Stack linear dimensions that share a side so they never overlap (greedy). */
export function layoutDims(dims: DimSpec[], gap: number): DimSpec[] {
  const out: DimSpec[] = [];
  const used = new Map<string, number>();
  for (const d of dims) {
    if (d.type !== 'linear' || !d.a || !d.b) {
      out.push(d);
      continue;
    }
    const dir = Math.atan2(d.b[1] - d.a[1], d.b[0] - d.a[0]);
    const off = d.offset ?? -8;
    // Group by line direction (mod 180°) and side.
    const key = `${Math.round((((dir * 180) / Math.PI + 360) % 180) / 5)}:${Math.sign(off)}`;
    const k = used.get(key) ?? 0;
    used.set(key, k + 1);
    out.push({ ...d, offset: off + Math.sign(off || -1) * k * gap });
  }
  return out;
}

function dimSvg(
  d: DimSpec,
  o: Required<Pick<SvgOptions, 'unit' | 'den'>> & { text: number },
  box: Box,
): string {
  const t = dimText(d, o.unit, o.den);
  const ah = o.text * 0.85;
  const parts: string[] = [];
  if (d.type === 'linear' && d.a && d.b) {
    const L = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) || 1;
    const u: Vec = [(d.b[0] - d.a[0]) / L, (d.b[1] - d.a[1]) / L];
    const nl: Vec = [u[1], -u[0]];
    const off = d.offset ?? -8;
    const s = Math.sign(off) || -1;
    const A: Vec = [d.a[0] + nl[0] * off, d.a[1] + nl[1] * off];
    const B: Vec = [d.b[0] + nl[0] * off, d.b[1] + nl[1] * off];
    for (const [p, q] of [
      [d.a, A],
      [d.b, B],
    ] as [Vec, Vec][]) {
      const g0: Vec = [p[0] + nl[0] * s * 1, p[1] + nl[1] * s * 1];
      const g1: Vec = [q[0] + nl[0] * s * 2, q[1] + nl[1] * s * 2];
      parts.push(`<line x1="${f(g0[0])}" y1="${f(g0[1])}" x2="${f(g1[0])}" y2="${f(g1[1])}" class="dl"/>`);
      grow(box, g1);
    }
    const inside = L >= 3 * ah;
    if (inside) {
      parts.push(`<line x1="${f(A[0])}" y1="${f(A[1])}" x2="${f(B[0])}" y2="${f(B[1])}" class="dl"/>`);
      parts.push(arrow(A, [-u[0], -u[1]], ah), arrow(B, u, ah));
    } else {
      const A2: Vec = [A[0] - u[0] * ah * 2.5, A[1] - u[1] * ah * 2.5];
      const B2: Vec = [B[0] + u[0] * ah * 2.5, B[1] + u[1] * ah * 2.5];
      parts.push(`<line x1="${f(A2[0])}" y1="${f(A2[1])}" x2="${f(B2[0])}" y2="${f(B2[1])}" class="dl"/>`);
      parts.push(arrow(A, u, ah), arrow(B, [-u[0], -u[1]], ah));
      grow(box, A2);
      grow(box, B2);
    }
    const mid: Vec = [
      (A[0] + B[0]) / 2 + nl[0] * s * o.text * 0.35,
      (A[1] + B[1]) / 2 + nl[1] * s * o.text * 0.35,
    ];
    const ang = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
    // Text sits on the outer side of the dimension line.
    const tp: Vec = s > 0 ? mid : [mid[0] - nl[0] * o.text * 0.9, mid[1] - nl[1] * o.text * 0.9];
    parts.push(textAt(s > 0 ? mid : tp, ang, t, o.text));
    grow(box, tp, o.text * 2.2);
  } else if ((d.type === 'diameter' || d.type === 'radius') && d.center && d.r) {
    const a = ((d.dirDeg ?? 35) * Math.PI) / 180;
    const u: Vec = [Math.cos(a), -Math.sin(a)];
    const c = d.center;
    const rim: Vec = [c[0] + u[0] * d.r, c[1] + u[1] * d.r];
    const lead: Vec = [rim[0] + u[0] * 8, rim[1] + u[1] * 8];
    const start: Vec = d.type === 'diameter' ? [c[0] - u[0] * d.r, c[1] - u[1] * d.r] : c;
    parts.push(
      `<line x1="${f(start[0])}" y1="${f(start[1])}" x2="${f(lead[0])}" y2="${f(lead[1])}" class="dl"/>`,
    );
    parts.push(arrow(rim, u, ah));
    if (d.type === 'diameter') parts.push(arrow(start, [-u[0], -u[1]], ah));
    const shelf: Vec = [lead[0] + (u[0] >= 0 ? 1 : -1) * t.length * o.text * 0.6, lead[1]];
    parts.push(
      `<line x1="${f(lead[0])}" y1="${f(lead[1])}" x2="${f(shelf[0])}" y2="${f(shelf[1])}" class="dl"/>`,
    );
    parts.push(textAt([(lead[0] + shelf[0]) / 2, lead[1] - o.text * 0.35], 0, t, o.text));
    grow(box, lead, o.text);
    grow(box, shelf, o.text * 1.5);
  } else if (d.type === 'angle' && d.vertex) {
    const r = d.rArc ?? 15;
    const a1 = d.a1 ?? 0;
    const a2 = d.a2 ?? 90;
    const pt = (deg: number): Vec => [
      d.vertex![0] + r * Math.cos((deg * Math.PI) / 180),
      d.vertex![1] + r * Math.sin((deg * Math.PI) / 180),
    ];
    let span = a2 - a1;
    while (span > 180) span -= 360;
    while (span < -180) span += 360;
    const p1 = pt(a1);
    const p2 = pt(a1 + span);
    parts.push(
      `<path d="M${f(p1[0])} ${f(p1[1])} A${f(r)} ${f(r)} 0 0 ${span > 0 ? 1 : 0} ${f(p2[0])} ${f(p2[1])}" class="dl" fill="none"/>`,
    );
    const tan = (deg: number, sgn: number): Vec => [
      -Math.sin((deg * Math.PI) / 180) * sgn,
      Math.cos((deg * Math.PI) / 180) * sgn,
    ];
    parts.push(arrow(p1, tan(a1, -Math.sign(span)), ah), arrow(p2, tan(a1 + span, Math.sign(span)), ah));
    const mid = pt(a1 + span / 2);
    const tp: Vec = [
      d.vertex[0] + (mid[0] - d.vertex[0]) * 1.35,
      d.vertex[1] + (mid[1] - d.vertex[1]) * 1.35,
    ];
    parts.push(textAt(tp, 0, t, o.text));
    grow(box, tp, o.text * 2);
  }
  return parts.join('');
}

export interface ViewSvg {
  body: string;
  box: Box;
}

export function viewSvg(view: DrawingView, opts: SvgOptions): ViewSvg {
  const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const text = opts.textMm ?? 3.5;
  const parts: string[] = [];
  if (opts.outlines !== false) for (const e of view.outline) parts.push(entitySvg(e, box));
  else for (const e of view.outline) entitySvg(e, box);
  for (const d of layoutDims(view.dims, text * 2.2))
    parts.push(dimSvg(d, { unit: opts.unit, den: opts.den, text }, box));
  if (!Number.isFinite(box.x0)) Object.assign(box, { x0: -10, y0: -10, x1: 10, y1: 10 });
  return { body: parts.join(''), box };
}

export function svgStyle(opts: SvgOptions): string {
  const k = opts.lineScale ?? 1;
  const c = opts.color ?? '#111827';
  const dc = opts.dimColor ?? c;
  const halo = opts.halo
    ? `paint-order:stroke;stroke:#fff;stroke-width:${f(0.8 * k)}px;stroke-linejoin:round;`
    : '';
  return `<style>
.ol{stroke:${c};stroke-width:${f(0.5 * k)};stroke-linejoin:round}
.cl{stroke:${c};stroke-width:${f(0.18 * k)};stroke-dasharray:${f(6 * k)} ${f(1.5 * k)} ${f(1 * k)} ${f(1.5 * k)}}
.hl{stroke:${c};stroke-width:${f(0.25 * k)};stroke-dasharray:${f(2 * k)} ${f(1 * k)}}
.dl{stroke:${dc};stroke-width:${f(0.25 * k)}}
.ah{fill:${dc}}
text{font-family:'Noto Sans','Helvetica',Arial,sans-serif;fill:${dc};${halo}}
</style>`;
}

/** All views side by side with a units note; returns a standalone SVG (mm user units). */
export function drawingSvg(
  views: RecordView[],
  opts: SvgOptions & { note?: string; projection?: 'first' | 'third' },
): string {
  const gap = 18;
  let x = 0;
  const groups: string[] = [];
  let h = 0;
  for (const v of views) {
    const vs = viewSvg(v.view, opts);
    const w = vs.box.x1 - vs.box.x0;
    groups.push(`<g transform="translate(${f(x - vs.box.x0)} ${f(-vs.box.y0)})">${vs.body}</g>`);
    x += w + gap;
    h = Math.max(h, vs.box.y1 - vs.box.y0);
  }
  const noteW = opts.note ? opts.note.length * 1.75 + 6 : 0;
  const symX = Math.max(x - gap - 16, noteW);
  const width = Math.max(40, x - gap, symX + 16);
  const note = opts.note ? `<text x="0" y="${f(h + 8)}" font-size="3">${esc(opts.note)}</text>` : '';
  const proj = projectionSymbol(symX, h + 3, opts.projection ?? 'first');
  const m = 6;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(-m)} ${f(-m)} ${f(width + 2 * m)} ${f(h + 12 + 2 * m)}" width="${f(width + 2 * m)}mm" height="${f(h + 12 + 2 * m)}mm">${svgStyle(opts)}${groups.join('')}${note}${proj}</svg>`;
}

/** ISO first/third-angle projection symbol (truncated cone), ~14 mm wide. */
export function projectionSymbol(x: number, y: number, kind: 'first' | 'third'): string {
  const cone = `<polygon points="${f(x)},${f(y + 1)} ${f(x + 7)},${f(y + 2.5)} ${f(x + 7)},${f(y + 5.5)} ${f(x)},${f(y + 7)}" class="dl" fill="none"/>`;
  const cx = kind === 'first' ? x + 12 : x - 5;
  const circles = `<circle cx="${f(cx)}" cy="${f(y + 4)}" r="3" class="dl" fill="none"/><circle cx="${f(cx)}" cy="${f(y + 4)}" r="1.5" class="dl" fill="none"/>`;
  return `<g>${cone}${circles}</g>`;
}
