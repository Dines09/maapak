// 2D vector helpers in mm space.
import type { Vec } from '../types';

export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec, b: Vec): number => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec): number => Math.hypot(a[0], a[1]);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const deg2rad = (d: number): number => (d * Math.PI) / 180;
export const rad2deg = (r: number): number => (r * 180) / Math.PI;

export function norm(a: Vec): Vec {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l] : [1, 0];
}

/** Unit vector at an angle (degrees, y axis pointing down as on screen). */
export const dirOf = (angleDeg: number): Vec => [Math.cos(deg2rad(angleDeg)), Math.sin(deg2rad(angleDeg))];

/** Rotate a point about a pivot. */
export function rotateAbout(p: Vec, pivot: Vec, angleDeg: number): Vec {
  const r = deg2rad(angleDeg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = p[0] - pivot[0];
  const dy = p[1] - pivot[1];
  return [pivot[0] + dx * c - dy * s, pivot[1] + dx * s + dy * c];
}

/** Normalise to (−180, 180]. */
export function normAngle(a: number): number {
  let x = a % 360;
  if (x <= -180) x += 360;
  if (x > 180) x -= 360;
  return x;
}

/** Signed parameter of the projection of p onto the line origin + t·dir (dir unit). */
export const projectT = (p: Vec, origin: Vec, dir: Vec): number => dot(sub(p, origin), dir);

/** Intersection of lines p1 + t·d1 and p2 + s·d2; null when parallel. */
export function lineIntersection(p1: Vec, d1: Vec, p2: Vec, d2: Vec): Vec | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(p2, p1), d2) / den;
  return add(p1, scale(d1, t));
}

/** Distance from p to segment ab. */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, scale(ab, t)));
}

export interface RectMm {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function inRect(p: Vec, r: RectMm, eps = 1e-6): boolean {
  return p[0] >= r.x - eps && p[0] <= r.x + r.w + eps && p[1] >= r.y - eps && p[1] <= r.y + r.h + eps;
}

/** Largest t ≥ 0 such that p + t·dir stays in the rect (p assumed inside). */
export function rayExitT(p: Vec, dir: Vec, r: RectMm): number {
  let t = Infinity;
  if (dir[0] > 1e-12) t = Math.min(t, (r.x + r.w - p[0]) / dir[0]);
  if (dir[0] < -1e-12) t = Math.min(t, (r.x - p[0]) / dir[0]);
  if (dir[1] > 1e-12) t = Math.min(t, (r.y + r.h - p[1]) / dir[1]);
  if (dir[1] < -1e-12) t = Math.min(t, (r.y - p[1]) / dir[1]);
  return Math.max(0, t);
}

/** Translation that brings all points inside the rect (centred if they cannot fit). */
export function fitShift(points: readonly Vec[], r: RectMm): Vec {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }
  const shift1 = (min: number, max: number, lo: number, size: number): number => {
    if (max - min > size) return lo + size / 2 - (min + max) / 2;
    if (min < lo) return lo - min;
    if (max > lo + size) return lo + size - max;
    return 0;
  };
  return [shift1(minX, maxX, r.x, r.w), shift1(minY, maxY, r.y, r.h)];
}

/** Clip the infinite line p + t·dir to a rect; returns [tMin, tMax] or null. */
export function clipLineToRect(p: Vec, dir: Vec, r: RectMm): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  const axes: [number, number, number, number][] = [
    [p[0], dir[0], r.x, r.x + r.w],
    [p[1], dir[1], r.y, r.y + r.h],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let a = (lo - o) / d;
    let b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/** Snap an angle to the nearest multiple of `step` (deg) when within `tol`; returns [angle, snapped]. */
export function snapAngle(angle: number, step: number, tol: number): [number, boolean] {
  const target = Math.round(angle / step) * step;
  return Math.abs(target - angle) <= tol ? [target, true] : [angle, false];
}
