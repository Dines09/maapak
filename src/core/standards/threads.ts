// Thread matchers (§6.6.2, §6.8.1). Sourced tables only (src/data/standards, §18).
import metric from '../../data/standards/threads-metric.json';
import unified from '../../data/standards/threads-unified.json';
import { MM_PER_INCH } from '../units';

interface MetricRow {
  size: string;
  d: number;
  coarse: number;
  fine: number[];
}
interface UnifiedRow {
  size: string;
  dIn: number;
  unc: number;
  unf: number;
}

export const METRIC_THREADS = metric.rows as MetricRow[];
export const UNIFIED_THREADS = unified.rows as UnifiedRow[];

export interface PitchMatch {
  system: 'metric' | 'inch';
  /** Pitch in mm (inch threads converted from TPI). */
  pitchMm: number;
  label: string;
  sizes: string[];
  deltaPct: number;
}

/** All distinct pitches of each family with the sizes that use them. */
function families() {
  const m = new Map<number, string[]>();
  for (const r of METRIC_THREADS) {
    for (const [p, kind] of [[r.coarse, ''], ...r.fine.map((f) => [f, ' fine'] as const)] as [
      number,
      string,
    ][]) {
      m.set(p, [...(m.get(p) ?? []), `${r.size}${kind ? `×${p}` : ''}`]);
    }
  }
  const i = new Map<number, string[]>();
  for (const r of UNIFIED_THREADS) {
    i.set(r.unc, [...(i.get(r.unc) ?? []), `${r.size}-${r.unc} UNC`]);
    i.set(r.unf, [...(i.get(r.unf) ?? []), `${r.size}-${r.unf} UNF`]);
  }
  return { m, i };
}
const FAM = families();

/** Nearest pitches in both families; the verdict compares relative errors (§6.8.1 metric vs inch). */
export function matchPitch(
  pMm: number,
  U: number,
): { metric: PitchMatch[]; inch: PitchMatch[]; verdict: 'metric' | 'inch' | 'unclear' } {
  const met = [...FAM.m.entries()]
    .map(([p, sizes]) => ({
      system: 'metric' as const,
      pitchMm: p,
      label: `P ${p} mm`,
      sizes,
      deltaPct: ((pMm - p) / p) * 100,
    }))
    .sort((a, b) => Math.abs(a.deltaPct) - Math.abs(b.deltaPct))
    .slice(0, 2);
  const inch = [...FAM.i.entries()]
    .map(([tpi, sizes]) => {
      const p = MM_PER_INCH / tpi;
      return {
        system: 'inch' as const,
        pitchMm: p,
        label: `${tpi} TPI`,
        sizes,
        deltaPct: ((pMm - p) / p) * 100,
      };
    })
    .sort((a, b) => Math.abs(a.deltaPct) - Math.abs(b.deltaPct))
    .slice(0, 2);
  const em = Math.abs(met[0].deltaPct);
  const ei = Math.abs(inch[0].deltaPct);
  const tolPct = (U / pMm) * 100;
  const verdict = Math.abs(em - ei) < Math.max(1, tolPct * 0.5) ? 'unclear' : em < ei ? 'metric' : 'inch';
  return { metric: met, inch, verdict };
}

/** Crest-count method: P = span / N; TPI = 25.4 / P (Appendix A). */
export const pitchFromCrests = (spanMm: number, n: number): number => spanMm / n;
export const tpiFromPitch = (pMm: number): number => MM_PER_INCH / pMm;

export interface NominalMatch {
  system: 'metric' | 'inch';
  size: string;
  dMm: number;
  deltaMm: number;
  /** The measured major diameter of an external thread sits slightly below nominal (§6.6.2). */
  plausible: boolean;
}

/**
 * Typical measured major diameter of an external thread: about 1.5 % under nominal (e.g. M8 measures
 * ≈ 7.76–7.97 mm). A matching aid only — the ISO 965 / ASME B1.1 limits are not loaded yet.
 */
const expectedMajor = (nominalMm: number): number => nominalMm * 0.985;

/** Nearest nominal sizes for a measured external-thread diameter. */
export function nominalFromDiameter(dMm: number, U: number): NominalMatch[] {
  const u = Math.max(U, 0.05);
  return [
    ...METRIC_THREADS.map((r) => ({ system: 'metric' as const, size: r.size, dMm: r.d })),
    ...UNIFIED_THREADS.map((r) => ({ system: 'inch' as const, size: r.size, dMm: r.dIn * MM_PER_INCH })),
  ]
    .map((c) => ({
      ...c,
      deltaMm: dMm - c.dMm,
      plausible: dMm >= c.dMm * 0.96 - U && dMm <= c.dMm + U,
      cost: ((dMm - expectedMajor(c.dMm)) / u) ** 2,
    }))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, 3)
    .map(({ cost: _c, ...rest }) => rest);
}

export interface BoltId {
  text: string;
  system: 'metric' | 'inch';
  confidence: number;
  nominal: NominalMatch;
  pitchMm?: number;
  alternatives: string[];
}

interface ThreadCandidate {
  system: 'metric' | 'inch';
  size: string;
  dMm: number;
  pitchMm: number;
  name: (lengthMm?: number) => string;
}

function threadCandidates(): ThreadCandidate[] {
  const out: ThreadCandidate[] = [];
  for (const r of METRIC_THREADS) {
    for (const p of [r.coarse, ...r.fine]) {
      out.push({
        system: 'metric',
        size: r.size,
        dMm: r.d,
        pitchMm: p,
        name: (L) => `${r.size} × ${p}${L ? ` × ${Math.round(L)}` : ''}`,
      });
    }
  }
  for (const r of UNIFIED_THREADS) {
    for (const [tpi, kind] of [
      [r.unc, 'UNC'],
      [r.unf, 'UNF'],
    ] as [number, string][]) {
      out.push({
        system: 'inch',
        size: r.size,
        dMm: r.dIn * MM_PER_INCH,
        pitchMm: MM_PER_INCH / tpi,
        name: (L) =>
          `${r.size}-${tpi}${L ? ` × ${(L / MM_PER_INCH).toFixed(2)}″` : ''}${kind === 'UNF' ? ' UNF' : ''}`,
      });
    }
  }
  return out;
}
const CANDIDATES = threadCandidates();

/** "M8 × 1.25 × 40": diameter and pitch matched jointly against real thread pairs (§6.6.2). */
export function identifyBolt(input: {
  dMm?: number;
  dU?: number;
  pMm?: number;
  pU?: number;
  lengthMm?: number;
}): BoltId | null {
  if (input.dMm === undefined) return null;
  const du = Math.max(input.dU ?? 0.2, 0.05);
  const pu = Math.max(input.pU ?? 0.05, 0.01);
  const scored = CANDIDATES.map((c) => {
    let cost = ((input.dMm! - expectedMajor(c.dMm)) / du) ** 2;
    if (input.pMm !== undefined) cost += ((input.pMm - c.pitchMm) / pu) ** 2;
    return { c, cost };
  }).sort((a, b) => a.cost - b.cost);
  // Without a pitch measurement, show the coarse / UNC variant of the best size.
  const best = input.pMm === undefined ? scored.find((x) => x.c.size === scored[0].c.size)! : scored[0];
  const nominal = nominalFromDiameter(input.dMm, input.dU ?? 0.2).find((n) => n.size === best.c.size) ?? {
    system: best.c.system,
    size: best.c.size,
    dMm: best.c.dMm,
    deltaMm: input.dMm - best.c.dMm,
    plausible: true,
  };
  const second = scored.find((x) => x.c.size !== best.c.size || x.c.pitchMm !== best.c.pitchMm);
  const margin = second ? second.cost - best.cost : 99;
  const confidence = Math.max(0.1, Math.min(0.95, Math.exp(-best.cost / 8) * (1 - Math.exp(-margin / 2))));
  return {
    text: best.c.name(input.lengthMm),
    system: best.c.system,
    confidence: input.pMm === undefined ? Math.min(confidence, 0.6) : confidence,
    nominal,
    pitchMm: input.pMm === undefined ? undefined : best.c.pitchMm,
    alternatives: scored.slice(1, 4).map((x) => x.c.name(input.lengthMm)),
  };
}
