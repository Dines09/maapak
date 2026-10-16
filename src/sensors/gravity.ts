// Gravity for the level (§6.9): DeviceMotion accelerationIncludingGravity, low-pass filtered, as a unit
// "up" vector in device coordinates. Browsers disagree on its sign, so the sign is checked against
// DeviceOrientation where that is well defined; without DeviceMotion the orientation angles are used.
import { useEffect, useState } from 'react';
import { upFromOrientation, type Vec3 } from '../core/level';

export interface Gravity {
  up: Vec3;
  /** Gyro rate around the screen normal (deg/s), when available. */
  rateZ: number | null;
  dt: number;
  t: number;
  live: boolean;
  source: 'motion' | 'orientation' | 'none';
}

type L = (g: Gravity) => void;
const ls = new Set<L>();
let g: Gravity = { up: [0, 0, 1], rateZ: null, dt: 0, t: 0, live: false, source: 'none' };
let sign = 1;
let signVotes = 0;
let lastMotion = 0;
let orientUp: Vec3 | null = null;
let attached = false;
const LP = 0.3;

const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};

function emit(next: Gravity): void {
  g = next;
  ls.forEach((l) => l(g));
}

function onMotion(e: DeviceMotionEvent): void {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x === null || a.y === null || a.z === null) return;
  const now = performance.now();
  const raw = unit([a.x, a.y, a.z]);
  if (orientUp && Math.abs(orientUp[2]) > 0.5) {
    const d = raw[0] * orientUp[0] + raw[1] * orientUp[1] + raw[2] * orientUp[2];
    signVotes = Math.max(-20, Math.min(20, signVotes + (d >= 0 ? 1 : -1)));
    sign = signVotes >= 0 ? 1 : -1;
  }
  const v: Vec3 = [raw[0] * sign, raw[1] * sign, raw[2] * sign];
  const up =
    g.live && g.source === 'motion'
      ? unit([
          g.up[0] + LP * (v[0] - g.up[0]),
          g.up[1] + LP * (v[1] - g.up[1]),
          g.up[2] + LP * (v[2] - g.up[2]),
        ])
      : v;
  const rate = e.rotationRate?.alpha;
  const dt = lastMotion ? (now - lastMotion) / 1000 : (e.interval ?? 16) / 1000;
  lastMotion = now;
  emit({ up, rateZ: typeof rate === 'number' ? rate : null, dt, t: now, live: true, source: 'motion' });
}

function onOrient(e: DeviceOrientationEvent): void {
  if (e.beta === null || e.gamma === null) return;
  orientUp = upFromOrientation(e.beta, e.gamma);
  // Fallback only while no motion events arrive.
  const now = performance.now();
  if (now - lastMotion > 500)
    emit({ up: orientUp, rateZ: null, dt: (now - g.t) / 1000, t: now, live: true, source: 'orientation' });
}

function attach(): void {
  if (attached || typeof window === 'undefined') return;
  attached = true;
  window.addEventListener('devicemotion', onMotion);
  window.addEventListener('deviceorientation', onOrient);
}

/** iOS: both motion and orientation need permission from a tap. */
export async function requestGravityPermission(): Promise<boolean> {
  type P = { requestPermission?: () => Promise<string> };
  const w = window as unknown as { DeviceMotionEvent?: P; DeviceOrientationEvent?: P };
  try {
    if (
      w.DeviceMotionEvent?.requestPermission &&
      (await w.DeviceMotionEvent.requestPermission()) !== 'granted'
    )
      return false;
    if (w.DeviceOrientationEvent?.requestPermission) await w.DeviceOrientationEvent.requestPermission();
  } catch {
    return false;
  }
  attach();
  return 'DeviceMotionEvent' in window || 'DeviceOrientationEvent' in window;
}

export function subscribeGravity(l: L): () => void {
  attach();
  ls.add(l);
  return () => ls.delete(l);
}

export function useGravity(): Gravity {
  const [v, setV] = useState(g);
  useEffect(() => subscribeGravity(setV), []);
  return v;
}
