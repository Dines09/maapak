// Spanner suggestion from a measured across-flats value (§6.6.1). Sourced data only (§18).
import metric from '../../data/standards/hex-af-metric.json';
import inch from '../../data/standards/hex-af-inch.json';
import { MM_PER_INCH } from '../units';

export interface WrenchCandidate {
  /** Spanner size label: "13 mm", "1/2″". */
  label: string;
  afMm: number;
  deltaMm: number;
  /** Fasteners using this spanner size, e.g. ["M8"] or ["M10 (DIN)"]. */
  fits: string[];
  system: 'metric' | 'inch';
  /** match: |Δ| ≤ U · close: ≤ 2U · far otherwise. */
  confidence: 'match' | 'close' | 'far';
  verified: boolean;
}

export interface StandardRow {
  size: string;
  af: number;
  system?: string;
  afLabel?: string;
  source: string;
  verified: boolean;
}

interface Entry {
  label: string;
  afMm: number;
  fits: string[];
  verified: boolean;
  system: 'metric' | 'inch';
}

function group(
  rows: StandardRow[],
  toMm: (af: number) => number,
  label: (r: StandardRow) => string,
  system: 'metric' | 'inch',
): Entry[] {
  const map = new Map<number, Entry>();
  for (const r of rows) {
    const afMm = toMm(r.af);
    const key = Math.round(afMm * 1000);
    const fit = r.system && r.system !== 'ISO/DIN' ? `${r.size} (${r.system})` : r.size;
    const e = map.get(key);
    if (e) {
      e.fits.push(fit);
      e.verified &&= r.verified;
    } else map.set(key, { label: label(r), afMm, fits: [fit], verified: r.verified, system });
  }
  return [...map.values()];
}

export const METRIC_ROWS = metric.rows as StandardRow[];
export const INCH_ROWS = inch.rows as StandardRow[];

const METRIC = group(METRIC_ROWS, (af) => af, (r) => `${r.af} mm`, 'metric');
const INCH = group(INCH_ROWS, (af) => af * MM_PER_INCH, (r) => r.afLabel ?? `${r.af}″`, 'inch');

/** Nearest spanner sizes per system, best first within each system. */
export function suggestWrenches(afMm: number, U: number, perSystem = 2): WrenchCandidate[] {
  const rank = (list: Entry[]): WrenchCandidate[] =>
    list
      .map((c) => {
        const deltaMm = afMm - c.afMm;
        const d = Math.abs(deltaMm);
        const confidence: WrenchCandidate['confidence'] = d <= U ? 'match' : d <= 2 * U ? 'close' : 'far';
        return { ...c, fits: [...c.fits], deltaMm, confidence };
      })
      .sort((a, b) => Math.abs(a.deltaMm) - Math.abs(b.deltaMm))
      .slice(0, perSystem);
  return [...rank(METRIC), ...rank(INCH)];
}

/** Metric or inch spanner, whichever is clearly closer. */
export function metricOrInch(afMm: number, U: number): 'metric' | 'inch' | 'unclear' {
  const all = suggestWrenches(afMm, U, 1);
  const m = all.find((c) => c.system === 'metric')!;
  const i = all.find((c) => c.system === 'inch')!;
  const dm = Math.abs(m.deltaMm);
  const di = Math.abs(i.deltaMm);
  if (Math.abs(dm - di) < Math.max(U * 0.5, 0.05)) return 'unclear';
  return dm < di ? 'metric' : 'inch';
}
