// O-ring cross-section series, wire gauges (AWG formula, SWG table), drill sizes (§6.4, §6.8). Sourced only.
import oring from '../../data/standards/oring-cs.json';
import wire from '../../data/standards/wire.json';
import { MM_PER_INCH } from '../units';

export interface CsMatch {
  label: string;
  csMm: number;
  deltaMm: number;
  system: 'AS568' | 'metric';
}

/** Nearest O-ring cross-sections (AS568 dash series and common metric). ID tables are not sourced yet. */
export function matchOringCs(csMm: number): CsMatch[] {
  const a = oring.as568.map((r) => ({
    label: `AS568 ${r.series} (${r.csIn}″)`,
    csMm: r.csMm,
    deltaMm: csMm - r.csMm,
    system: 'AS568' as const,
  }));
  const m = oring.metricCs.map((c) => ({
    label: `${c} mm`,
    csMm: c,
    deltaMm: csMm - c,
    system: 'metric' as const,
  }));
  const best = (l: CsMatch[]) => l.sort((x, y) => Math.abs(x.deltaMm) - Math.abs(y.deltaMm))[0];
  return [best(a), best(m)];
}

/** AWG: d(mm) = 0.127 × 92^((36 − n)/39); n = 36 − 39·log₉₂(d / 0.127) (Appendix A). */
export const awgDiameter = (n: number): number => 0.127 * 92 ** ((36 - n) / 39);
export const awgFromDiameter = (dMm: number): number => 36 - 39 * (Math.log(dMm / 0.127) / Math.log(92));

export const wireArea = (dMm: number): number => (Math.PI * dMm * dMm) / 4;

export function nearestSwg(dMm: number): { swg: number; dMm: number; deltaMm: number } {
  return wire.swg
    .map((r) => ({ ...r, deltaMm: dMm - r.dMm }))
    .sort((a, b) => Math.abs(a.deltaMm) - Math.abs(b.deltaMm))[0];
}

export function nearestCable(areaMm2: number): { mm2: number; deltaPct: number } {
  return wire.cableMm2
    .map((a) => ({ mm2: a, deltaPct: ((areaMm2 - a) / a) * 100 }))
    .sort((x, y) => Math.abs(x.deltaPct) - Math.abs(y.deltaPct))[0];
}

/** Drills: metric in 0.1 mm steps and fractional inch in 1/64″ steps (number/letter drills not sourced). */
export function nearestDrills(dMm: number): { label: string; dMm: number; deltaMm: number }[] {
  const metric = Math.round(dMm * 10) / 10;
  const n64 = Math.round((dMm / MM_PER_INCH) * 64);
  let num = n64;
  let den = 64;
  while (num % 2 === 0 && den > 1) {
    num /= 2;
    den /= 2;
  }
  const fracMm = (n64 * MM_PER_INCH) / 64;
  return [
    { label: `${metric.toFixed(1)} mm`, dMm: metric, deltaMm: dMm - metric },
    { label: den === 1 ? `${num}″` : `${num}/${den}″`, dMm: fracMm, deltaMm: dMm - fracMm },
  ];
}
