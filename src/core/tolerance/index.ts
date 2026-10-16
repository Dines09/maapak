// Tolerance go / no-go (§7.5) with guard bands from the measurement uncertainty.

export interface Tolerance {
  nominal: number;
  lower: number;
  upper: number;
}

export type TolResult = 'pass' | 'warn' | 'fail';

export function fromPlusMinus(nominal: number, plus: number, minus: number): Tolerance {
  return { nominal, lower: nominal - Math.abs(minus), upper: nominal + Math.abs(plus) };
}

/**
 * Green when the value is inside the limits by more than U, amber when it is within U of a limit
 * (either side, so the verdict is not certain), red when it is out by more than U.
 */
export function evaluateTolerance(value: number, U: number, tol: Tolerance): TolResult {
  const u = Math.max(0, U);
  if (value >= tol.lower + u && value <= tol.upper - u) return 'pass';
  if (value >= tol.lower - u && value <= tol.upper + u) return 'warn';
  return 'fail';
}
