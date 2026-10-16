// Record sheet PDF, measurement card image, 1:1 print template (§11, §12). Loaded on demand.
import type { PartRecord } from '../../core/types';
import type { FractionDenominator, LengthUnit } from '../../core/units';
import { db } from '../../db';
import { recordViews } from '../drawing/model';
import { drawingSvg, svgStyle, viewSvg } from '../drawing/svg';
import { annotatedPhotoSvg, svgToCanvas } from '../drawing/annotate';
import { blobToDataUrl, photoForSheet, valueText } from './common';

export interface SheetOptions {
  unit: LengthUnit;
  den: FractionDenominator;
  paper: 'a4' | 'letter';
  projection: 'first' | 'third';
  company?: string;
  engineer?: string;
  /** Translated strings for the sheet. */
  text: Record<
    | 'label'
    | 'feature'
    | 'value'
    | 'tol'
    | 'notes'
    | 'units'
    | 'date'
    | 'by'
    | 'calibration'
    | 'partNo'
    | 'projection'
    | 'scale'
    | 'pass'
    | 'warn'
    | 'fail',
    string
  >;
  featureName(kind: string): string;
}

const LATIN = new RegExp('^[\x20-\x7E\u00A0-\u00FF]*$');

/** PDF-safe text: WinAnsi Helvetica covers Latin-1 (Ø ± ° ×); map the rest, or flag it for raster. */
function latin(s: string): string {
  return s
    .replace(/−/g, '-')
    .replace(/″/g, '"')
    .replace(/′/g, "'")
    .replace(/…/g, '...')
    .replace(/[–—]/g, '-')
    .replace(/²/g, '²');
}

async function photoDataUrl(
  rec: PartRecord,
  opts: SheetOptions,
  maxPx = 1600,
): Promise<{ url: string; w: number; h: number } | null> {
  const p = photoForSheet(rec);
  if (!p) return null;
  const row = await db.blobs.get(p.blobKey);
  if (!row) return null;
  const href = await blobToDataUrl(row.blob);
  const k = Math.min(1, maxPx / Math.max(p.width, p.height));
  const canvas = await svgToCanvas(
    annotatedPhotoSvg(rec, p, href, opts.unit, opts.den),
    Math.round(p.width * k),
    Math.round(p.height * k),
  );
  return { url: canvas.toDataURL('image/jpeg', 0.88), w: canvas.width, h: canvas.height };
}

/** Text that jsPDF's standard font cannot shape (e.g. Hindi) is drawn by the browser into an image. */
function textImage(text: string, sizeMm: number, bold = false): { url: string; wMm: number; hMm: number } {
  const pxPerMm = 12;
  const c = document.createElement('canvas');
  const x = c.getContext('2d')!;
  const font = `${bold ? 700 : 400} ${sizeMm * 0.75 * pxPerMm}px "Noto Sans Devanagari","Noto Sans",system-ui,sans-serif`;
  x.font = font;
  const w = Math.ceil(x.measureText(text).width) + 4;
  const h = Math.ceil(sizeMm * pxPerMm * 1.1);
  c.width = w;
  c.height = h;
  x.font = font;
  x.fillStyle = '#111827';
  x.textBaseline = 'middle';
  x.fillText(text, 2, h / 2);
  return { url: c.toDataURL('image/png'), wMm: w / pxPerMm, hMm: h / pxPerMm };
}

export async function recordPdf(rec: PartRecord, opts: SheetOptions): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  await import('svg2pdf.js');
  const doc = new jsPDF({ unit: 'mm', format: opts.paper, orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 12;
  const put = (
    s: string,
    x: number,
    y: number,
    size: number,
    bold = false,
    align: 'left' | 'right' | 'center' = 'left',
  ) => {
    if (LATIN.test(latin(s))) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize((size / 25.4) * 72);
      doc.text(latin(s), x, y, { align, baseline: 'middle' });
    } else {
      const im = textImage(s, size, bold);
      const x0 = align === 'right' ? x - im.wMm : align === 'center' ? x - im.wMm / 2 : x;
      doc.addImage(im.url, 'PNG', x0, y - im.hMm / 2, im.wMm, im.hMm);
    }
  };

  // Header
  put(rec.name, M, M + 3, 6, true);
  put(new Date(rec.updatedAt).toLocaleDateString(), W - M, M + 3, 3.2, false, 'right');
  doc.setDrawColor(17, 24, 39);
  doc.setLineWidth(0.4);
  doc.line(M, M + 7, W - M, M + 7);
  let y = M + 11;

  // Photo with dimension overlay
  const ph = await photoDataUrl(rec, opts);
  if (ph) {
    const maxH = 78;
    const k = Math.min((W - 2 * M) / ph.w, maxH / ph.h);
    const w = ph.w * k;
    const h = ph.h * k;
    doc.addImage(ph.url, 'JPEG', (W - w) / 2, y, w, h);
    y += h + 5;
  }

  // 2D drawing (vector)
  const views = recordViews(rec);
  if (views.length) {
    const svg = drawingSvg(views, { unit: opts.unit, den: opts.den, projection: opts.projection });
    const el = new DOMParser().parseFromString(svg, 'image/svg+xml')
      .documentElement as unknown as SVGSVGElement;
    const vb = el.getAttribute('viewBox')!.split(' ').map(Number);
    const maxW = W - 2 * M;
    const maxH = Math.min(85, H - y - 95);
    const k = Math.min(1, maxW / vb[2], maxH / vb[3]);
    const w = vb[2] * k;
    const h = vb[3] * k;
    document.body.appendChild(el);
    try {
      await (doc as unknown as { svg(e: Element, o: object): Promise<unknown> }).svg(el, {
        x: (W - w) / 2,
        y,
        width: w,
        height: h,
      });
    } finally {
      el.remove();
    }
    put(
      `${opts.text.scale} ${k >= 0.999 ? '1:1' : `1:${(1 / k).toFixed(1)}`}`,
      W - M,
      y + h - 2,
      2.6,
      false,
      'right',
    );
    y += h + 5;
  }

  // Dimension table
  const cols = [M, M + 22, M + 80, M + 118, M + 140];
  doc.setFillColor(241, 245, 249);
  doc.rect(M, y - 3.5, W - 2 * M, 7, 'F');
  [opts.text.label, opts.text.feature, opts.text.value, '±', opts.text.tol].forEach((h, i) =>
    put(h, cols[i] + 1, y, 3, true),
  );
  y += 7;
  for (const m of rec.measurements) {
    if (y > H - 58) {
      doc.addPage();
      y = M + 6;
    }
    const vt = valueText(m, opts.unit);
    const tol = m.tolerance?.result ? `${opts.text[m.tolerance.result]}` : '';
    put(m.label, cols[0] + 1, y, 3, true);
    put(opts.featureName(m.kind), cols[1] + 1, y, 3);
    put(`${vt.v} ${vt.unit}`, cols[2] + 1, y, 3);
    put(vt.u, cols[3] + 1, y, 3);
    put(tol, cols[4] + 1, y, 3, !!tol);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(M, y + 3.2, W - M, y + 3.2);
    y += 6.5;
  }

  // Notes + title block (bottom)
  const tbY = H - M - 34;
  doc.setDrawColor(17, 24, 39);
  doc.setLineWidth(0.4);
  doc.rect(M, tbY, W - 2 * M, 34);
  doc.line(W / 2, tbY, W / 2, tbY + 34);
  put(opts.text.notes, M + 2, tbY + 4, 2.8, true);
  const notes = (rec.notes ?? '').slice(0, 300);
  notes
    .split('\n')
    .slice(0, 6)
    .forEach((l, i) => put(l, M + 2, tbY + 9 + i * 4, 2.8));
  const tx = W / 2 + 2;
  const rows: [string, string][] = [
    [opts.text.partNo, rec.partNo ?? '—'],
    [opts.text.date, new Date(rec.updatedAt).toLocaleString()],
    [opts.text.by, rec.measuredBy ?? opts.engineer ?? '—'],
    [opts.text.units, opts.unit === 'in-frac' ? 'in' : opts.unit],
    [opts.text.calibration, rec.calibrationLabel ?? '—'],
  ];
  if (opts.company) put(opts.company, tx, tbY + 4, 3.2, true);
  rows.forEach(([k, v], i) => {
    put(k, tx, tbY + 10 + i * 4.6, 2.6, true);
    put(v, tx + 26, tbY + 10 + i * 4.6, 2.6);
  });
  // Projection symbol
  const symX = W - M - 22;
  const symY = tbY + 22;
  doc.setLineWidth(0.25);
  doc.lines(
    [
      [7, 1.5],
      [0, 3],
      [-7, 1.5],
    ],
    symX,
    symY + 1,
    [1, 1],
    'S',
    true,
  );
  const cx = opts.projection === 'first' ? symX + 12 : symX - 5;
  doc.circle(cx, symY + 4, 3);
  doc.circle(cx, symY + 4, 1.5);
  put(opts.text.projection, symX - 4, symY + 9.5, 2.2);
  return doc.output('blob');
}

/** Phone-friendly measurement card, 1080 × 1350 (§12). */
export async function recordCard(
  rec: PartRecord,
  opts: SheetOptions,
  type: 'image/jpeg' | 'image/png',
): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, W, H);
  x.fillStyle = '#0f172a';
  x.fillRect(0, 0, W, 120);
  x.fillStyle = '#ffffff';
  x.font = '700 52px "Noto Sans","Noto Sans Devanagari",system-ui,sans-serif';
  x.fillText(rec.name, 40, 78);
  x.font = '400 28px system-ui,sans-serif';
  x.textAlign = 'right';
  x.fillText(new Date(rec.updatedAt).toLocaleDateString(), W - 40, 78);
  x.textAlign = 'left';
  let y = 140;
  const ph = await photoDataUrl(rec, opts, 1400);
  const area = { w: W - 80, h: 620 };
  let img: CanvasImageSource | null = null;
  let iw = 0;
  let ih = 0;
  if (ph) {
    const im = new Image();
    im.src = ph.url;
    await im.decode();
    img = im;
    iw = ph.w;
    ih = ph.h;
  } else {
    const views = recordViews(rec);
    if (views.length) {
      const svg = drawingSvg(views, { unit: opts.unit, den: opts.den, projection: opts.projection });
      const vb = /viewBox="([^"]+)"/.exec(svg)![1].split(' ').map(Number);
      const k = Math.min(area.w / vb[2], area.h / vb[3]);
      img = await svgToCanvas(svg, Math.round(vb[2] * k), Math.round(vb[3] * k));
      iw = (img as HTMLCanvasElement).width;
      ih = (img as HTMLCanvasElement).height;
    }
  }
  if (img) {
    const k = Math.min(area.w / iw, area.h / ih);
    x.drawImage(img, (W - iw * k) / 2, y, iw * k, ih * k);
    y += ih * k + 30;
  }
  x.font = '600 34px system-ui,sans-serif';
  for (const m of rec.measurements.slice(0, 10)) {
    const vt = valueText(m, opts.unit);
    x.fillStyle = '#0369a1';
    x.fillText(m.label, 40, y);
    x.fillStyle = '#334155';
    x.font = '400 30px "Noto Sans","Noto Sans Devanagari",system-ui,sans-serif';
    x.fillText(opts.featureName(m.kind), 170, y);
    x.fillStyle = '#0f172a';
    x.font = '700 38px system-ui,sans-serif';
    x.textAlign = 'right';
    x.fillText(`${vt.v} ${vt.unit}`, W - 200, y);
    x.font = '400 26px system-ui,sans-serif';
    x.fillStyle = '#64748b';
    x.fillText(`±${vt.u}`, W - 40, y);
    x.textAlign = 'left';
    x.font = '600 34px system-ui,sans-serif';
    y += 56;
    if (y > H - 80) break;
  }
  x.fillStyle = '#64748b';
  x.font = '400 22px system-ui,sans-serif';
  x.fillText(`Maapak · ${rec.calibrationLabel ?? ''}`, 40, H - 32);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), type, 0.9));
}

/** 1:1 print template (§12): outlines at true size with a 100 mm check bar. */
export function templateSvg(rec: PartRecord, opts: Pick<SheetOptions, 'unit' | 'den'>, note: string): string {
  const views = recordViews(rec);
  const parts: string[] = [];
  let x = 0;
  let h = 0;
  for (const v of views) {
    const vs = viewSvg({ outline: v.view.outline, dims: [] }, { unit: opts.unit, den: opts.den });
    parts.push(`<g transform="translate(${x - vs.box.x0} ${-vs.box.y0})">${vs.body}</g>`);
    x += vs.box.x1 - vs.box.x0 + 15;
    h = Math.max(h, vs.box.y1 - vs.box.y0);
  }
  const width = Math.max(110, x);
  const bar = `<g transform="translate(0 ${h + 10})"><rect x="0" y="0" width="100" height="4" fill="none" class="dl"/>${Array.from(
    { length: 11 },
    (_, i) => `<line x1="${i * 10}" y1="0" x2="${i * 10}" y2="${i % 5 === 0 ? 7 : 5.5}" class="dl"/>`,
  ).join(
    '',
  )}<text x="0" y="13" font-size="3.5">0</text><text x="96" y="13" font-size="3.5">100 mm</text><text x="0" y="21" font-size="3.5">${note}</text></g>`;
  const total = h + 36;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 ${width + 10} ${total + 10}" width="${width + 10}mm" height="${total + 10}mm">${svgStyle({ unit: opts.unit, den: opts.den })}${parts.join('')}${bar}</svg>`;
}

export async function templatePdf(svg: string, paper: 'a4' | 'letter'): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  await import('svg2pdf.js');
  const doc = new jsPDF({ unit: 'mm', format: paper });
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml')
    .documentElement as unknown as SVGSVGElement;
  const vb = el.getAttribute('viewBox')!.split(' ').map(Number);
  document.body.appendChild(el);
  try {
    // 1 SVG unit = 1 mm: true scale.
    await (doc as unknown as { svg(e: Element, o: object): Promise<unknown> }).svg(el, {
      x: 10,
      y: 10,
      width: vb[2],
      height: vb[3],
    });
  } finally {
    el.remove();
  }
  return doc.output('blob');
}
