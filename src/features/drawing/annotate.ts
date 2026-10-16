// Annotated photo (§11 a): dimension lines drawn on the photo, positioned from the ghost alignment.
import type { PartRecord, PhotoRef } from '../../core/types';
import type { FractionDenominator, LengthUnit } from '../../core/units';
import { recordViews } from './model';
import { svgStyle, viewSvg } from './svg';

/** 3×3 row-major [m0 m1 m2; m3 m4 m5; 0 0 1] → SVG matrix(a b c d e f). */
export function svgMatrix(m: readonly number[]): string {
  return `matrix(${m[0]} ${m[3]} ${m[1]} ${m[4]} ${m[2]} ${m[5]})`;
}

/** Similarity transform part-mm → photo-px: scale k (px/mm), rotation (deg), translation. */
export function similarity(k: number, rotDeg: number, tx: number, ty: number): number[] {
  const r = (rotDeg * Math.PI) / 180;
  const c = Math.cos(r) * k;
  const s = Math.sin(r) * k;
  return [c, -s, tx, s, c, ty, 0, 0, 1];
}

export function applyH(m: readonly number[], p: [number, number]): [number, number] {
  const w = m[6] * p[0] + m[7] * p[1] + m[8] || 1;
  return [(m[0] * p[0] + m[1] * p[1] + m[2]) / w, (m[3] * p[0] + m[4] * p[1] + m[5]) / w];
}

/**
 * SVG of the photo with the record's first drawing view overlaid through ghostToPhoto. `href` is a blob or
 * data URL (data URL when the SVG will be rasterised).
 */
export function annotatedPhotoSvg(
  rec: PartRecord,
  photo: PhotoRef,
  href: string,
  unit: LengthUnit,
  den: FractionDenominator,
): string {
  const views = recordViews(rec);
  let overlay = '';
  if (photo.ghostToPhoto && views[0]) {
    const k = Math.hypot(photo.ghostToPhoto[0], photo.ghostToPhoto[3]) || 1; // px per mm
    // Text and lines sized for the photo, not for paper.
    const textMm = Math.max(14, photo.width * 0.028) / k;
    const vs = viewSvg(views[0].view, { unit, den, textMm, halo: true });
    const style = svgStyle({
      unit,
      den,
      color: '#0ea5e9',
      dimColor: '#facc15',
      halo: true,
      lineScale: Math.max(2.5, photo.width * 0.004) / k / 0.5,
    });
    overlay = `${style}<g transform="${svgMatrix(photo.ghostToPhoto)}">${vs.body}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${photo.width} ${photo.height}" preserveAspectRatio="xMidYMid meet"><image href="${href}" x="0" y="0" width="${photo.width}" height="${photo.height}"/>${overlay}</svg>`;
}

/** Rasterise an SVG string to a canvas (images inside must be data URLs). */
export async function svgToCanvas(svg: string, w: number, h: number): Promise<HTMLCanvasElement> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('svg render'));
      img.src = url;
    });
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d')!;
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, w, h);
    x.drawImage(img, 0, 0, w, h);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}
