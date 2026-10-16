// Uncertainty model and honest-precision rule (§7.6, Appendix A).
import { fromMm, type LengthUnit } from '../units';

export type ScreenProtector = 'none' | 'film' | 'tempered';

/**
 * Glass stack in front of the pixels (mm). Typical phone cover glass is 0.5–0.8 mm; protectors add to it.
 * These are conservative modelling assumptions, not measured values.
 */
export const GLASS_MM = { cover: 0.7, film: 0.15, tempered: 0.45 } as const;
export const GLASS_INDEX = 1.5;
/** Assumed off-axis viewing angle for the parallax term (§7.6). */
export const PARALLAX_ASSUMED_DEG = 10;
/** Relative scale uncertainty while uncalibrated (§2.1: estimate can be off 15–20%). */
export const ESTIMATE_REL_CAL = 0.2;

/** Apparent depth of the glass stack ≈ t / n. */
export function apparentGlassDepthMm(protector: ScreenProtector): number {
  const t = GLASS_MM.cover + (protector === 'none' ? 0 : GLASS_MM[protector]);
  return t / GLASS_INDEX;
}

/** Parallax error e ≈ (t / n) · tan θ. */
export function parallaxMm(protector: ScreenProtector, angleDeg = PARALLAX_ASSUMED_DEG): number {
  return apparentGlassDepthMm(protector) * Math.tan((angleDeg * Math.PI) / 180);
}

/** r_cal ≈ (√2 × edge alignment error) / calibration baseline, both in device px. */
export function relCalUncertainty(alignmentErrorPx: number, baselineMm: number, pxPerMm: number): number {
  if (baselineMm <= 0 || pxPerMm <= 0) return ESTIMATE_REL_CAL;
  return (Math.SQRT2 * alignmentErrorPx) / (baselineMm * pxPerMm);
}

export interface LengthUncertaintyInput {
  lengthMm: number;
  /** Device px per mm along the measured direction. */
  pxPerMm: number;
  /** Relative calibration uncertainty r_cal. */
  relCal: number;
  screenProtector: ScreenProtector;
  /** Loupe used for alignment (1 px per edge) or not (2 px). Default true. */
  withLoupe?: boolean;
  /** Number of aligned edges (2 for a length between two markers). */
  edges?: number;
}

export interface UncertaintyBreakdown {
  uRes: number;
  uAlign: number;
  uCal: number;
  uParallax: number;
  /** Combined standard uncertainty. */
  u: number;
  /** Expanded U = 2u rounded up to one significant figure. */
  U: number;
}

/** u_total = √(u_res² + u_align² + (L·r_cal)² + u_parallax²); U = 2·u_total (rounded up, 1 s.f.). */
export function lengthUncertainty(i: LengthUncertaintyInput): UncertaintyBreakdown {
  const edges = i.edges ?? 2;
  const ppm = i.pxPerMm > 0 ? i.pxPerMm : 1;
  const uRes = (0.5 * Math.sqrt(edges)) / ppm;
  const uAlign = ((i.withLoupe === false ? 2 : 1) * Math.sqrt(edges)) / ppm;
  const uCal = Math.abs(i.lengthMm) * i.relCal;
  const uParallax = parallaxMm(i.screenProtector);
  const u = Math.sqrt(uRes ** 2 + uAlign ** 2 + uCal ** 2 + uParallax ** 2);
  return { uRes, uAlign, uCal, uParallax, u, U: roundUpOneSig(2 * u) };
}

/** Combine independent expanded uncertainties (root-sum-square), e.g. leapfrog segments (grows as √N). */
export function combineRss(values: readonly number[]): number {
  return roundUpOneSig(Math.sqrt(values.reduce((s, v) => s + v * v, 0)));
}

/** Round up to one significant figure: 0.23 → 0.3, 0.06 → 0.06, 1.2 → 2. */
export function roundUpOneSig(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 0;
  const m = 10 ** Math.floor(Math.log10(x));
  // Small epsilon so exact values (0.2) are not bumped by float noise.
  const k = Math.ceil(x / m - 1e-9);
  return Number((k * m).toPrecision(1));
}

/** Decimals shown = max(0, −⌊log₁₀ U⌋), with U expressed in the display unit. */
export function decimalsFor(uMm: number, unit: LengthUnit): number {
  const U = fromMm(uMm, unit);
  if (!(U > 0)) return unit === 'mm' ? 1 : 2;
  return Math.min(4, Math.max(0, -Math.floor(Math.log10(U))));
}

/** Decimals for an area value given the expanded area uncertainty already in display units². */
export function decimalsForValue(U: number): number {
  if (!(U > 0)) return 1;
  return Math.min(4, Math.max(0, -Math.floor(Math.log10(U))));
}

/** Standard uncertainty of one aligned point (one edge, no calibration term), mm. */
export function pointUncertainty(pxPerMm: number, protector: ScreenProtector, withLoupe = true): number {
  return lengthUncertainty({
    lengthMm: 0,
    pxPerMm,
    relCal: 0,
    screenProtector: protector,
    withLoupe,
    edges: 1,
  }).u;
}

/**
 * Expanded uncertainty of an angle defined by arms of length Lᵢ whose end points each carry a standard
 * point uncertainty u (vertex + two arms, or two 2-point lines): u_θ = u·√(2·Σ 1/Lᵢ²) rad.
 */
export function angleUncertaintyDeg(uPointMm: number, armsMm: readonly number[]): number {
  const s = armsMm.reduce((acc, L) => acc + 1 / Math.max(L, 1e-6) ** 2, 0);
  const uRad = uPointMm * Math.sqrt(2 * s);
  return roundUpOneSig(Math.min(180, (2 * uRad * 180) / Math.PI));
}

export interface RepeatStats {
  n: number;
  mean: number;
  /** max − min */
  spread: number;
  /** Sample standard deviation (0 for n < 2). */
  s: number;
  /** Expanded uncertainty of the mean. */
  U: number;
}

/**
 * Repeat & average (§7.7). The random part of one reading (U/2 without the calibration term), or the
 * observed scatter if that is larger, shrinks with √n; the calibration (systematic) part does not.
 */
export function repeatStats(samples: readonly number[], singleU: number, relCal: number): RepeatStats | null {
  const n = samples.length;
  if (n === 0) return null;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const spread = Math.max(...samples) - Math.min(...samples);
  const s = n > 1 ? Math.sqrt(samples.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const uSingle = singleU / 2;
  const uSys = Math.abs(mean) * relCal;
  const uRandSingle = Math.sqrt(Math.max(0, uSingle ** 2 - uSys ** 2));
  const uRand = Math.max(uRandSingle, s);
  const uMean = Math.sqrt(uRand ** 2 / n + uSys ** 2);
  return { n, mean, spread, s, U: roundUpOneSig(2 * uMean) };
}
