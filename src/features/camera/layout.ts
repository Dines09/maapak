// Geometry shared by the camera screen and its tests: ghost placement on the viewfinder and the mapping
// from part millimetres to photo pixels (§10.6).
import type { GhostShape } from '../../render/types';
import { similarity } from '../drawing/annotate';

export interface ViewLayout {
  /** CSS px per mm of the ghost on screen. */
  k: number;
  /** Ghost origin (part centre) on screen, CSS px. */
  cx: number;
  cy: number;
  /** object-fit: cover — CSS px per video px, and the video's top-left offset. */
  sv: number;
  ox: number;
  oy: number;
}

/** Ghost scaled to ~65 % of the frame, centred, true proportions (§10.3). */
export function viewLayout(
  cw: number,
  ch: number,
  vw: number,
  vh: number,
  ghost: GhostShape,
  fill = 0.65,
): ViewLayout {
  const [x0, y0, x1, y1] = ghost.boundsMm;
  const gw = Math.max(1, x1 - x0);
  const gh = Math.max(1, y1 - y0);
  const k = fill * Math.min(cw / gw, ch / gh);
  const sv = Math.max(cw / vw, ch / vh);
  return {
    k,
    cx: cw / 2 - k * ((x0 + x1) / 2),
    cy: ch / 2 - k * ((y0 + y1) / 2),
    sv,
    ox: (cw - vw * sv) / 2,
    oy: (ch - vh * sv) / 2,
  };
}

/** Ghost edge points in a downscaled frame (frame px = video px × f). */
export function ghostInFrame(ghost: GhostShape, L: ViewLayout, f: number): Float32Array {
  const out = new Float32Array(ghost.edgeSamples.length * 2);
  ghost.edgeSamples.forEach(([x, y], i) => {
    out[2 * i] = ((L.cx + L.k * x - L.ox) / L.sv) * f;
    out[2 * i + 1] = ((L.cy + L.k * y - L.oy) / L.sv) * f;
  });
  return out;
}

/**
 * Part-mm → photo-px similarity, including the matcher's refinement (dx, dy in frame px, scale s and
 * rotation rot about the ghost centroid). `kp` = photo px per video px.
 */
export function ghostToPhoto(
  ghost: GhostShape,
  L: ViewLayout,
  f: number,
  kp: number,
  refine: { dx: number; dy: number; s: number; rot: number } = { dx: 0, dy: 0, s: 1, rot: 0 },
): { matrix: number[]; mmPerPx: number } {
  const A = L.k / L.sv; // video px per mm
  const B: [number, number] = [(L.cx - L.ox) / L.sv, (L.cy - L.oy) / L.sv];
  const n = ghost.edgeSamples.length || 1;
  const cm = ghost.edgeSamples.reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n], [0, 0]);
  const cg: [number, number] = [A * cm[0] + B[0], A * cm[1] + B[1]];
  const r = (refine.rot * Math.PI) / 180;
  const c = Math.cos(r) * refine.s;
  const s = Math.sin(r) * refine.s;
  // q = s·R·(B − cg) + cg + d/f   (video px), then × kp.
  const bx = B[0] - cg[0];
  const by = B[1] - cg[1];
  const tx = (c * bx - s * by + cg[0] + refine.dx / f) * kp;
  const ty = (s * bx + c * by + cg[1] + refine.dy / f) * kp;
  const scale = kp * refine.s * A;
  return { matrix: similarity(scale, refine.rot, tx, ty), mmPerPx: 1 / scale };
}
