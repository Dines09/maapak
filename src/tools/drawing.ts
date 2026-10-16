// Shared helpers for each tool's toDrawing() (§11) and toGhost() (§10). Part frame: mm, origin at the part
// centre, y down (as on screen). Shapes keep true proportions.
import type { FeatureKind, Vec } from '../core/types';
import { acrossCorners } from '../core/geometry/fit';
import type { DimSpec, DrawingEntities, Entity, GhostShape, Path2DLike } from '../render/types';

export function rectPts(w: number, h: number, r = 0): Vec[] {
  const hw = w / 2;
  const hh = h / 2;
  const rr = Math.max(0, Math.min(r, hw, hh));
  if (rr < 0.05) {
    return [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ];
  }
  const pts: Vec[] = [];
  const corners: [number, number, number][] = [
    [hw - rr, -hh + rr, -90],
    [hw - rr, hh - rr, 0],
    [-hw + rr, hh - rr, 90],
    [-hw + rr, -hh + rr, 180],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= 8; k++) {
      const a = ((a0 + (k * 90) / 8) * Math.PI) / 180;
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  }
  return pts;
}

/** Regular hexagon (or square) with flats facing ±x. */
export function nutPts(af: number, sides: 4 | 6): Vec[] {
  const R = sides === 6 ? acrossCorners(af) / 2 : (af * Math.SQRT2) / 2;
  const step = 360 / sides;
  return Array.from({ length: sides }, (_, k) => {
    const a = ((step / 2 + k * step) * Math.PI) / 180;
    return [R * Math.cos(a), R * Math.sin(a)] as Vec;
  });
}

function samplePolyline(pts: readonly Vec[], closed: boolean, step: number): Vec[] {
  const out: Vec[] = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(L / step));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  return out;
}

/** Ghost overlay from outline paths, with edge samples every ~0.75 mm for the matcher. */
export function ghostFrom(paths: Path2DLike[]): GhostShape {
  const samples: Vec[] = [];
  for (const p of paths) {
    if (p.kind === 'circle' && p.center && p.r) {
      const k = Math.max(24, Math.ceil((2 * Math.PI * p.r) / 0.75));
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2;
        samples.push([p.center[0] + p.r * Math.cos(a), p.center[1] + p.r * Math.sin(a)]);
      }
    } else if (p.points) samples.push(...samplePolyline(p.points, !!p.closed, 0.75));
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of samples) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { paths, edgeSamples: samples, boundsMm: [x0, y0, x1, y1] };
}

export function linear(
  kind: FeatureKind,
  label: string,
  value: number,
  U: number,
  a: Vec,
  b: Vec,
  offset: number,
): DimSpec {
  return { kind, label, value, uncertainty: U, type: 'linear', a, b, offset };
}

export function diameter(
  kind: FeatureKind,
  label: string,
  value: number,
  U: number,
  center: Vec,
  dirDeg = 35,
): DimSpec {
  return { kind, label, value, uncertainty: U, type: 'diameter', center, r: value / 2, dirDeg };
}

/** Two short end marks and a length dimension (for rulers / calipers without a known outline). */
export function spanDrawing(kind: FeatureKind, label: string, L: number, U: number): DrawingEntities {
  const h = Math.max(6, Math.min(16, L * 0.25));
  const outline: Entity[] = [
    { type: 'line', a: [-L / 2, -h / 2], b: [-L / 2, h / 2] },
    { type: 'line', a: [L / 2, -h / 2], b: [L / 2, h / 2] },
    { type: 'line', a: [-L / 2, 0], b: [L / 2, 0], style: 'centre' },
  ];
  return {
    views: { top: { outline, dims: [linear(kind, label, L, U, [-L / 2, h / 2], [L / 2, h / 2], -8)] } },
  };
}
