// The single mm ↔ device-px transform (§3.2, §3.10). No other scale factors anywhere.
import type { Vec } from '../types';
import type { CalibrationProfile } from './profile';

/** Orientation angles 90/270 swap the natural portrait axes. */
export function isAxisSwapped(orientationAngle: number): boolean {
  const a = (((Math.round(orientationAngle / 90) * 90) % 360) + 360) % 360;
  return a === 90 || a === 270;
}

export interface ScreenTransform {
  /** Device px per mm along the CURRENT screen x / y axes. */
  sx: number;
  sy: number;
  dpr: number;
  mmToDevicePx(p: Vec): Vec;
  devicePxToMm(p: Vec): Vec;
  cssPxToMm(p: Vec): Vec;
  mmToCssPx(p: Vec): Vec;
  /** Device px per mm along a direction given in mm space. */
  pxPerMmAlong(dir: Vec): number;
}

export function makeTransform(
  profile: Pick<CalibrationProfile, 'pxPerMmX' | 'pxPerMmY'>,
  orientationAngle: number,
  dpr: number,
): ScreenTransform {
  const swapped = isAxisSwapped(orientationAngle);
  const sx = swapped ? profile.pxPerMmY : profile.pxPerMmX;
  const sy = swapped ? profile.pxPerMmX : profile.pxPerMmY;
  return {
    sx,
    sy,
    dpr,
    mmToDevicePx: (p) => [p[0] * sx, p[1] * sy],
    devicePxToMm: (p) => [p[0] / sx, p[1] / sy],
    cssPxToMm: (p) => [(p[0] * dpr) / sx, (p[1] * dpr) / sy],
    mmToCssPx: (p) => [(p[0] * sx) / dpr, (p[1] * sy) / dpr],
    pxPerMmAlong: (d) => {
      const l = Math.hypot(d[0], d[1]) || 1;
      return Math.hypot((d[0] / l) * sx, (d[1] / l) * sy);
    },
  };
}
