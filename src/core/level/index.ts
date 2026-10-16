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

const wrap180 = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;

/** Up vector in device coordinates from DeviceOrientation β, γ (W3C Z-X'-Y'' Euler angles, deg). */
export function upFromOrientation(betaDeg: number, gammaDeg: number): Vec3 {
  const b = (betaDeg * Math.PI) / 180;
  const g = (gammaDeg * Math.PI) / 180;
  return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
}

/**
 * Steady angle for the level display (§6.9): accelerometer angle fused with the gyro rate through a
 * complementary filter, then the median of recent samples. The gyro's sign is learned from how it
 * correlates with the accelerometer angle (browsers differ), and it is only used once that is clear.
 */
export class LevelFilter {
  private angle: number | null = null;
  private lastAcc: number | null = null;
  private corr = 0;
  private recent: number[] = [];
  constructor(
    private readonly alpha = 0.98,
    private readonly window = 15,
  ) {}

  push(accAngle: number, gyroDegPerS: number | null, dtS: number): number {
    if (this.angle === null) this.angle = accAngle;
    if (gyroDegPerS !== null && this.lastAcc !== null && dtS > 0) {
      this.corr = this.corr * 0.995 + gyroDegPerS * (wrap180(accAngle - this.lastAcc) / dtS);
    }
    this.lastAcc = accAngle;
    const useGyro = gyroDegPerS !== null && Math.abs(this.corr) > 50 && dtS > 0 && dtS < 0.2;
    const pred = useGyro ? this.angle + Math.sign(this.corr) * gyroDegPerS! * dtS : this.angle;
    // Complementary step on the wrapped difference so ±180° does not jump.
    const a = useGyro ? this.alpha : 0.85;
    this.angle = wrap180(pred + (1 - a) * wrap180(accAngle - pred));
    this.recent.push(this.angle);
    if (this.recent.length > this.window) this.recent.shift();
    // Median relative to the newest value (wrap-safe) — only while steady, so moving readings do not lag.
    const ref = this.angle;
    const rel = this.recent.map((x) => wrap180(x - ref));
    if (Math.max(...rel) - Math.min(...rel) > 1) return ref;
    return wrap180(ref + median(rel));
  }

  reset(): void {
    this.angle = null;
    this.lastAcc = null;
    this.recent = [];
  }
}
