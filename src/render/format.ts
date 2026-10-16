// Honest number formatting shared by canvas tags and the HUD (§7.6).
import {
  areaFromMm2,
  formatFraction,
  formatNumber,
  fromMm,
  toFraction,
  unitSymbol,
  type FractionDenominator,
  type LengthUnit,
} from '../core/units';
import { decimalsFor, decimalsForValue } from '../core/uncertainty';

/** Length in the display unit with decimals derived from U (no unit symbol). */
export function fmtLength(
  mm: number,
  Umm: number,
  unit: LengthUnit,
  den: FractionDenominator,
  raw = false,
): string {
  if (unit === 'in-frac') return formatFraction(toFraction(mm, den));
  const d = raw ? (unit === 'mm' ? 3 : 4) : decimalsFor(Umm, unit);
  return formatNumber(fromMm(mm, unit), d);
}

export function fmtArea(mm2: number, Umm2: number, unit: LengthUnit, raw = false): string {
  const u = unit === 'in-frac' ? 'in' : unit;
  const v = areaFromMm2(mm2, u);
  const U = areaFromMm2(Umm2, u);
  return formatNumber(v, raw ? 3 : decimalsForValue(U));
}

export function unitLabel(unit: LengthUnit): string {
  return unit === 'in-frac' ? 'in' : unitSymbol(unit);
}

/** "37.4°" with decimals from U, never more than 0.1° (§6.3). */
export function fmtAngle(value: number, U: number): string {
  const d = U > 0 ? Math.min(1, Math.max(0, -Math.floor(Math.log10(U)))) : 1;
  return `${value.toFixed(d)}°`;
}
