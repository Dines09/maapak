// Orientation / motion service (§16.5): filtered tilt, shared by the camera tilt bubble and the level.
import { useEffect, useState } from 'react';

export interface Tilt {
  /** Front-back tilt (deg): 0 when the phone lies flat, 90 when upright. */
  beta: number;
  /** Left-right tilt (deg). */
  gamma: number;
  /** Compass-ish heading (deg), when available. */
  alpha: number;
  /** True once the sensor has reported at least once. */
  live: boolean;
}

type Listener = (t: Tilt) => void;
const listeners = new Set<Listener>();
let state: Tilt = { beta: 0, gamma: 0, alpha: 0, live: false };
let attached = false;
const ALPHA = 0.25; // low-pass factor

function onOrient(e: DeviceOrientationEvent): void {
  if (e.beta === null || e.gamma === null) return;
  const lp = (prev: number, v: number) => (state.live ? prev + ALPHA * (v - prev) : v);
  state = { beta: lp(state.beta, e.beta), gamma: lp(state.gamma, e.gamma), alpha: e.alpha ?? 0, live: true };
  listeners.forEach((l) => l(state));
}

function attach(): void {
  if (attached || typeof window === 'undefined') return;
  attached = true;
  window.addEventListener('deviceorientation', onOrient);
}

/** iOS needs permission from a user gesture. Returns true when sensors can be used. */
export async function requestMotionPermission(): Promise<boolean> {
  const DOE = (
    window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }
  ).DeviceOrientationEvent;
  try {
    if (DOE?.requestPermission) return (await DOE.requestPermission()) === 'granted';
  } catch {
    return false;
  }
  attach();
  return 'DeviceOrientationEvent' in window;
}

export function subscribeTilt(l: Listener): () => void {
  attach();
  listeners.add(l);
  return () => listeners.delete(l);
}

export function currentTilt(): Tilt {
  return state;
}

export function useTilt(): Tilt {
  const [t, setT] = useState(state);
  useEffect(() => subscribeTilt(setT), []);
  return t;
}

/** Tilt error from the pose a camera view needs: flat (top view) or upright (side / front view). */
export function tiltError(t: Tilt, view: 'top' | 'side' | 'front'): number {
  if (!t.live) return 0;
  if (view === 'top') return Math.max(Math.abs(t.beta), Math.abs(t.gamma));
  return Math.max(Math.abs(Math.abs(t.beta) - 90), Math.abs(t.gamma));
}
