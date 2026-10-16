// Bolt circle / PCD finder (§6.5, Appendix A): least-squares circle through hole centres, N, angular
// pitch 360°/N and a uniformity check (angular deviation of each hole from an evenly spaced pattern).
import type { Vec } from '../types';
import { fitCircle } from './fit';

export interface PcdResult {
  c: Vec;
  /** PCD (diameter, mm). */
  pcd: number;
  /** Standard uncertainty of the PCD from the fit. */
  uPcd: number;
  n: number;
  /** Ideal angular pitch, 360/N (deg). */
  pitchDeg: number;
  /** Per hole (input order): angular deviation from the even pattern (deg) and radial deviation (mm). */
  angDev: number[];
  radDev: number[];
  maxAngDev: number;
}

const wrap180 = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;

export function pcdFit(centres: readonly Vec[], pointU = 0): PcdResult | null {
  const n = centres.length;
  if (n < 3) return null;
  const f = fitCircle(centres, 30, pointU);
  if (!f) return null;
  const step = 360 / n;
  const ang = centres.map((p) => (Math.atan2(p[1] - f.c[1], p[0] - f.c[0]) * 180) / Math.PI);
  const order = ang.map((a, i) => [a, i] as const).sort((x, y) => x[0] - y[0]);
  // Best rotation of the ideal pattern: circular mean of (θ_k − k·step) over the sorted holes.
  let sx = 0;
  let sy = 0;
  order.forEach(([a], k) => {
    const r = ((a - k * step) * Math.PI) / 180;
    sx += Math.cos(r);
    sy += Math.sin(r);
  });
  const off = (Math.atan2(sy, sx) * 180) / Math.PI;
  const angDev = new Array<number>(n).fill(0);
  order.forEach(([a, i], k) => (angDev[i] = wrap180(a - k * step - off)));
  const radDev = centres.map((p) => Math.hypot(p[0] - f.c[0], p[1] - f.c[1]) - f.r);
  return {
    c: f.c,
    pcd: 2 * f.r,
    uPcd: 2 * f.uR,
    n,
    pitchDeg: step,
    angDev,
    radDev,
    maxAngDev: Math.max(...angDev.map(Math.abs)),
  };
}
