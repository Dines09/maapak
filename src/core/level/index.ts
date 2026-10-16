// Level & inclinometer math (§6.9, Appendix A). Pure functions so they can be tested.

export type Vec3 = [number, number, number];

/** Surface tilt (bullseye): phone lying on the surface; x = roll, y = pitch, deg. */
export function surfaceTilt(g: Vec3): [number, number] {
  const [x, y, z] = g;
  const r = (a: number) => (a * 180) / Math.PI;
  return [r(Math.atan2(x, Math.hypot(y, z))), r(Math.atan2(y, Math.hypot(x, z)))];
}

/** Edge angle: phone standing on an edge (screen vertical); 0 when the bottom edge is level. */
export function edgeAngle(g: Vec3): number {
  const [x, y] = g;
  return (Math.atan2(x, y) * 180) / Math.PI;
}

/** Signed deviation from the nearest multiple of 90° (horizontal or vertical / plumb). */
export function fromNearestAxis(a: number): { deviation: number; axis: number } {
  const axis = Math.round(a / 90) * 90;
  return { deviation: a - axis, axis: ((axis % 360) + 360) % 360 };
}

export const slopePct = (deg: number): number => Math.tan((deg * Math.PI) / 180) * 100;
export const slopeMmPerM = (deg: number): number => Math.tan((deg * Math.PI) / 180) * 1000;
/** Ratio 1:x with x = 1/tan θ (Infinity when level). */
export const slopeRatio = (deg: number): number => {
  const t = Math.tan((Math.abs(deg) * Math.PI) / 180);
  return t < 1e-9 ? Infinity : 1 / t;
};

/** Two-position reversal calibration: offset = (a₁ + a₂)/2 for readings at 0° and 180° placement. */
export const reversalOffset = (a1: number, a2: number): number => (a1 + a2) / 2;

export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Complementary filter step: angle ≈ α·(angle + gyro·dt) + (1 − α)·accelAngle (§6.9, α ≈ 0.98). */
export function complementary(
  prev: number,
  gyroDegPerS: number,
  dtS: number,
  accelAngle: number,
  alpha = 0.98,
): number {
  return alpha * (prev + gyroDegPerS * dtS) + (1 - alpha) * accelAngle;
}
