// Unit conversion and formatting (§3.1, Appendix A). Canonical unit is the millimetre.

export type LengthUnit = 'mm' | 'cm' | 'in' | 'in-frac';
export type FractionDenominator = 16 | 32 | 64;

/** Exact by definition. */
export const MM_PER_INCH = 25.4;

export const mmToInch = (mm: number): number => mm / MM_PER_INCH;
export const inchToMm = (inch: number): number => inch * MM_PER_INCH;
export const mmToCm = (mm: number): number => mm / 10;
export const cmToMm = (cm: number): number => cm * 10;

/** Millimetres → value in the display unit ('in-frac' gives decimal inches). */
export function fromMm(mm: number, unit: LengthUnit): number {
  switch (unit) {
    case 'mm':
      return mm;
    case 'cm':
      return mm / 10;
    case 'in':
    case 'in-frac':
      return mm / MM_PER_INCH;
  }
}

/** Value in a display unit → millimetres. */
export function toMm(value: number, unit: LengthUnit): number {
  switch (unit) {
    case 'mm':
      return value;
    case 'cm':
      return value * 10;
    case 'in':
    case 'in-frac':
      return value * MM_PER_INCH;
  }
}

/** Area: mm² → display unit squared. */
export function areaFromMm2(mm2: number, unit: LengthUnit): number {
  const f = fromMm(1, unit);
  return mm2 * f * f;
}

export function unitSymbol(unit: LengthUnit): string {
  switch (unit) {
    case 'mm':
      return 'mm';
    case 'cm':
      return 'cm';
    case 'in':
    case 'in-frac':
      return 'in';
  }
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

export interface Fraction {
  negative: boolean;
  whole: number;
  num: number;
  den: number;
  /** |true − fraction| in mm. */
  errorMm: number;
}

/** Nearest fraction of an inch with denominator D (reduced). n = round(in × D) / D. */
export function toFraction(mm: number, denominator: FractionDenominator): Fraction {
  const inches = Math.abs(mm) / MM_PER_INCH;
  const n = Math.round(inches * denominator);
  const whole = Math.floor(n / denominator);
  let num = n - whole * denominator;
  let den: number = denominator;
  if (num === 0) {
    den = 1;
  } else {
    const g = gcd(num, den);
    num /= g;
    den /= g;
  }
  return {
    negative: mm < 0 && n !== 0,
    whole,
    num,
    den,
    errorMm: Math.abs(inches - n / denominator) * MM_PER_INCH,
  };
}

/** "1 43/64″", "3/8″", "2″". */
export function formatFraction(f: Fraction): string {
  const sign = f.negative ? '−' : '';
  if (f.num === 0) return `${sign}${f.whole}″`;
  if (f.whole === 0) return `${sign}${f.num}/${f.den}″`;
  return `${sign}${f.whole} ${f.num}/${f.den}″`;
}

/** Fixed decimals with a real minus sign and no "-0.0". */
export function formatNumber(value: number, decimals: number): string {
  const d = Math.max(0, Math.min(6, Math.round(decimals)));
  let s = value.toFixed(d);
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  return s.replace('-', '−');
}

/** "42.3 mm", "4.23 cm", "1.665 in". For 'in-frac' use formatFraction instead. */
export function formatLength(mm: number, unit: LengthUnit, decimals: number): string {
  return `${formatNumber(fromMm(mm, unit), decimals)} ${unitSymbol(unit)}`;
}
