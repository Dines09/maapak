// Calibration profiles and calibration math (§5.2, Appendix A).
import type { DeviceKey } from './deviceKey';
import { ESTIMATE_REL_CAL, relCalUncertainty, type ScreenProtector } from '../uncertainty';

export type CalibrationMethod = 'card' | 'ruler' | 'coin' | 'custom' | 'estimate';
export type Confidence = 'estimate' | 'good' | 'excellent';

export interface CalibrationProfile {
  id: string;
  name: string;
  deviceKey: DeviceKey;
  /** DEVICE px per mm, natural portrait X axis (short side). */
  pxPerMmX: number;
  /** DEVICE px per mm, natural portrait Y axis (long side). */
  pxPerMmY: number;
  method: CalibrationMethod;
  referenceLabel: string;
  baselineMm: { x: number; y: number };
  alignmentErrorPx: number;
  verifyResidualMm?: number;
  screenProtector: ScreenProtector;
  confidence: Confidence;
  createdAt: number;
}

/** ISO/IEC 7810 ID-1 card (§18). Long edge goes along the portrait long axis (Y). */
export const ID1_CARD = { longMm: 85.6, shortMm: 53.98, cornerRadiusMm: 3.18 } as const;

/** Android reference density: 1 CSS px ≈ 1/160 inch (§2.1). Estimate only. */
export const ESTIMATE_MM_PER_CSS_PX = 25.4 / 160;

/** Default alignment error per edge with the loupe (§7.6). */
export const DEFAULT_ALIGNMENT_ERROR_PX = 1;

/** Axes agreeing within this are averaged; beyond WARN they are kept separate and the user is warned. */
export const AXIS_AVERAGE_TOLERANCE = 0.005;
export const AXIS_WARN_TOLERANCE = 0.01;

export interface AxisResult {
  pxPerMmX: number;
  pxPerMmY: number;
  /** |x − y| / mean. */
  disagreement: number;
  averaged: boolean;
  warn: boolean;
}

/** Combine two independently measured axes per §5.2. */
export function combineAxes(pxPerMmX: number, pxPerMmY: number): AxisResult {
  const mean = (pxPerMmX + pxPerMmY) / 2;
  const disagreement = Math.abs(pxPerMmX - pxPerMmY) / mean;
  if (disagreement <= AXIS_AVERAGE_TOLERANCE) {
    return { pxPerMmX: mean, pxPerMmY: mean, disagreement, averaged: true, warn: false };
  }
  return { pxPerMmX, pxPerMmY, disagreement, averaged: false, warn: disagreement > AXIS_WARN_TOLERANCE };
}

/** pxPerMm = alignedDevicePx / referenceMm (per axis). */
export function axisScale(alignedDevicePx: number, referenceMm: number): number {
  if (!(referenceMm > 0) || !(alignedDevicePx > 0)) throw new Error('Invalid calibration input');
  return alignedDevicePx / referenceMm;
}

/** Card method: X spans the short edge (53.98), Y spans the long edge (85.60). */
export function cardCalibration(alignedDevicePxX: number, alignedDevicePxY: number): AxisResult {
  return combineAxes(
    axisScale(alignedDevicePxX, ID1_CARD.shortMm),
    axisScale(alignedDevicePxY, ID1_CARD.longMm),
  );
}

export function estimatePxPerMm(dpr: number): number {
  return dpr / ESTIMATE_MM_PER_CSS_PX;
}

export function estimateProfile(deviceKey: DeviceKey): CalibrationProfile {
  const s = estimatePxPerMm(deviceKey.dpr);
  return {
    id: 'estimate',
    name: 'Estimate',
    deviceKey,
    pxPerMmX: s,
    pxPerMmY: s,
    method: 'estimate',
    referenceLabel: '1 CSS px ≈ 1/160 in',
    baselineMm: { x: 0, y: 0 },
    alignmentErrorPx: 0,
    screenProtector: 'none',
    confidence: 'estimate',
    createdAt: 0,
  };
}

/** Estimate / Good (card, coin, custom, ruler) / Excellent (ruler, verified residual ≤ 0.1 mm). */
export function confidenceFor(method: CalibrationMethod, verifyResidualMm?: number): Confidence {
  if (method === 'estimate') return 'estimate';
  if (method === 'ruler' && verifyResidualMm !== undefined && Math.abs(verifyResidualMm) <= 0.1) {
    return 'excellent';
  }
  return 'good';
}

/** Verify residual above this suggests recalibrating (§5.2). */
export const VERIFY_RESIDUAL_LIMIT_MM = 0.3;

/** Relative calibration uncertainty r_cal for a profile (worst axis). */
export function profileRelCal(p: CalibrationProfile): number {
  if (p.method === 'estimate') return ESTIMATE_REL_CAL;
  const rx = relCalUncertainty(p.alignmentErrorPx, p.baselineMm.x, p.pxPerMmX);
  const ry = relCalUncertainty(p.alignmentErrorPx, p.baselineMm.y, p.pxPerMmY);
  return Math.max(rx, ry);
}
