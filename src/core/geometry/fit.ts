// Circle fits, polygon measures and hexagon relations (Appendix A).
import type { Vec } from '../types';
import { cross, dot, rad2deg, sub } from './index';

export interface Circle {
  c: Vec;
  r: number;
}

/** Circle through three points (Appendix A); null when the points are (nearly) collinear. */
export function circleFrom3(p1: Vec, p2: Vec, p3: Vec): Circle | null {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const D = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  const scale = Math.max(1, Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(x2 - x3) + Math.abs(y2 - y3)) ** 2;
  if (Math.abs(D) < 1e-9 * scale) return null;
  const s1 = x1 * x1 + y1 * y1;
  const s2 = x2 * x2 + y2 * y2;
  const s3 = x3 * x3 + y3 * y3;
  const cx = (s1 * (y2 - y3) + s2 * (y3 - y1) + s3 * (y1 - y2)) / D;
  const cy = (s1 * (x3 - x2) + s2 * (x1 - x3) + s3 * (x2 - x1)) / D;
  return { c: [cx, cy], r: Math.hypot(x1 - cx, y1 - cy) };
}

/** Solve a 3×3 linear system by Gaussian elimination with partial pivoting. */
export function solve3(A: number[][], b: number[]): number[] | null {
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-14) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let k = col; k < 4; k++) m[r][k] -= f * m[col][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/** Algebraic (Kåsa) least-squares circle: minimise Σ(x² + y² + Dx + Ey + F)². */
export function fitCircleKasa(pts: readonly Vec[]): Circle | null {
  if (pts.length < 3) return null;
  // Work relative to the centroid for numerical stability.
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxx = 0,
    sxy = 0,
    syy = 0,
    sx = 0,
    sy = 0,
    sxz = 0,
    syz = 0,
    sz = 0;
  for (const [px, py] of pts) {
    const x = px - mx;
    const y = py - my;
    const z = x * x + y * y;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sx += x;
    sy += y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }
  const n = pts.length;
  const sol = solve3(
    [
      [sxx, sxy, sx],
      [sxy, syy, sy],
      [sx, sy, n],
    ],
    [-sxz, -syz, -sz],
  );
  if (!sol) return null;
  const [D, E, F] = sol;
  const cx = -D / 2;
  const cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (!(r2 > 0)) return null;
  return { c: [cx + mx, cy + my], r: Math.sqrt(r2) };
}

export interface CircleFit extends Circle {
  /** RMS radial residual (mm). */
  rms: number;
  /** max − min of 2·(radial distance) (mm). */
  ovality: number;
  n: number;
}

/** Kåsa start refined with geometric Gauss–Newton: minimise Σ(|p − c| − r)². */
export function fitCircle(pts: readonly Vec[], iterations = 30): CircleFit | null {
  if (pts.length < 3) return null;
  let start: Circle | null = pts.length === 3 ? circleFrom3(pts[0], pts[1], pts[2]) : fitCircleKasa(pts);
  if (!start) return null;
  let [cx, cy] = start.c;
  let r = start.r;
  for (let it = 0; it < iterations && pts.length > 3; it++) {
    const JtJ = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const Jtr = [0, 0, 0];
    for (const [x, y] of pts) {
      const d = Math.hypot(x - cx, y - cy) || 1e-12;
      const res = d - r;
      const J = [-(x - cx) / d, -(y - cy) / d, -1];
      for (let i = 0; i < 3; i++) {
        Jtr[i] += J[i] * res;
        for (let k = 0; k < 3; k++) JtJ[i][k] += J[i] * J[k];
      }
    }
    const step = solve3(
      JtJ,
      Jtr.map((v) => -v),
    );
    if (!step) break;
    cx += step[0];
    cy += step[1];
    r += step[2];
    if (Math.hypot(step[0], step[1], step[2]) < 1e-12) break;
  }
  start = { c: [cx, cy], r: Math.abs(r) };
  const dists = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  const rms = Math.sqrt(dists.reduce((s, d) => s + (d - start!.r) ** 2, 0) / pts.length);
  return {
    ...start,
    rms,
    ovality: 2 * (Math.max(...dists) - Math.min(...dists)),
    n: pts.length,
  };
}

/** Shoelace formula: A = ½ |Σ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)|. */
export function signedArea(pts: readonly Vec[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export const polygonArea = (pts: readonly Vec[]): number => Math.abs(signedArea(pts));

export function pathLength(pts: readonly Vec[], closed: boolean): number {
  let s = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
}

/** Interior angle at every vertex of a closed polygon (deg, concave vertices > 180). */
export function interiorAngles(pts: readonly Vec[]): number[] {
  const orient = Math.sign(signedArea(pts)) || 1;
  return pts.map((cur, i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const next = pts[(i + 1) % pts.length];
    const v1 = sub(prev, cur);
    const v2 = sub(next, cur);
    let a = rad2deg(Math.atan2(cross(v2, v1), dot(v2, v1)));
    if (orient < 0) a = -a;
    return ((a % 360) + 360) % 360;
  });
}

/** Angle between two lines (deg, 0–180) from their direction vectors. */
export function angleBetween(d1: Vec, d2: Vec): number {
  const l = Math.hypot(d1[0], d1[1]) * Math.hypot(d2[0], d2[1]);
  if (l === 0) return 0;
  return rad2deg(Math.acos(Math.max(-1, Math.min(1, dot(d1, d2) / l))));
}

/** Hexagon: AC = AF × 2/√3. Square: diagonal = AF × √2. */
export const acrossCorners = (af: number): number => (af * 2) / Math.sqrt(3);
export const acrossFlatsFromCorners = (ac: number): number => (ac * Math.sqrt(3)) / 2;
export const squareDiagonal = (af: number): number => af * Math.SQRT2;

/** Even-odd point-in-polygon test. */
export function pointInPolygon(p: Vec, pts: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
