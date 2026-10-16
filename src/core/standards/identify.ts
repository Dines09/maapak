// "What is this?" Part Identifier (§6.10): checks the current readouts against every sourced table.
import type { FeatureKind } from '../types';
import { formatNumber } from '../units';
import { suggestWrenches } from './hex';
import { matchPitch, nominalFromDiameter } from './threads';
import { awgFromDiameter, matchOringCs, nearestCable, nearestDrills, nearestSwg, wireArea } from './misc';

export interface IdReading {
  kind: FeatureKind;
  value: number;
  uncertainty: number;
}

export interface IdMatch {
  /** i18n key of the category. */
  category: 'nut' | 'thread' | 'pitch' | 'oring' | 'wire' | 'drill';
  title: string;
  detail: string;
  /** 0–1 */
  confidence: number;
}

const mm = (v: number) => `${formatNumber(v, 2)} mm`;
const conf = (delta: number, U: number) =>
  Math.max(0.05, Math.min(0.95, 1 - Math.abs(delta) / Math.max(U * 3, 0.15)));

export function identify(readings: IdReading[]): IdMatch[] {
  const out: IdMatch[] = [];
  for (const r of readings) {
    if (r.kind === 'acrossFlats') {
      for (const c of suggestWrenches(r.value, r.uncertainty, 1)) {
        out.push({
          category: 'nut',
          title: `${c.label} — ${c.fits.join(', ')}`,
          detail: `Δ ${mm(c.deltaMm)}`,
          confidence: conf(c.deltaMm, r.uncertainty),
        });
      }
    }
    if (r.kind === 'diameter' || r.kind === 'outerDiameter') {
      for (const n of nominalFromDiameter(r.value, r.uncertainty).slice(0, 2)) {
        out.push({
          category: 'thread',
          title: n.size,
          detail: `Δ ${mm(n.deltaMm)}${n.plausible ? '' : ' ?'}`,
          confidence: conf(n.plausible ? n.deltaMm / 4 : n.deltaMm, r.uncertainty),
        });
      }
      if (r.value < 6) {
        const awg = awgFromDiameter(r.value);
        const swg = nearestSwg(r.value);
        const cab = nearestCable(wireArea(r.value));
        out.push({
          category: 'wire',
          title: `AWG ${awg.toFixed(1)} · SWG ${swg.swg}`,
          detail: `${formatNumber(wireArea(r.value), 2)} mm² → ${cab.mm2} mm²`,
          confidence: conf(swg.deltaMm, r.uncertainty) * 0.8,
        });
      }
      for (const d of nearestDrills(r.value)) {
        out.push({
          category: 'drill',
          title: d.label,
          detail: `Δ ${mm(d.deltaMm)}`,
          confidence: conf(d.deltaMm, r.uncertainty) * 0.7,
        });
      }
    }
    if (r.kind === 'crossSection') {
      for (const c of matchOringCs(r.value)) {
        out.push({
          category: 'oring',
          title: c.label,
          detail: `Δ ${mm(c.deltaMm)}`,
          confidence: conf(c.deltaMm, r.uncertainty),
        });
      }
    }
    if (r.kind === 'pitch') {
      const m = matchPitch(r.value, r.uncertainty);
      for (const p of [m.metric[0], m.inch[0]]) {
        out.push({
          category: 'pitch',
          title: `${p.label}`,
          detail: `${p.sizes.slice(0, 3).join(', ')} · Δ ${formatNumber(p.deltaPct, 1)} %`,
          confidence: Math.max(0.05, 1 - Math.abs(p.deltaPct) / 8),
        });
      }
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}
