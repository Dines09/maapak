// Ghost matching (§10.5): grayscale → blur → Sobel edges → distance transform → chamfer score of the
// ghost's edge points; a small search over shift/scale/rotation gives directional hints. Pure functions,
// run in a Web Worker on a ~320 px frame.

export interface Gray {
  w: number;
  h: number;
  data: Float32Array;
}

export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Gray {
  const data = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4)
    data[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return { w, h, data };
}

/** 3×3 box blur (edge pixels clamped). */
export function blur3(g: Gray): Gray {
  const { w, h, data } = g;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) s += data[yy * w + Math.min(w - 1, Math.max(0, x + dx))];
      }
      out[y * w + x] = s / 9;
    }
  }
  return { w, h, data: out };
}

export function sobel(g: Gray): Gray {
  const { w, h, data } = g;
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -data[i - w - 1] -
        2 * data[i - 1] -
        data[i + w - 1] +
        data[i - w + 1] +
        2 * data[i + 1] +
        data[i + w + 1];
      const gy =
        -data[i - w - 1] -
        2 * data[i - w] -
        data[i - w + 1] +
        data[i + w - 1] +
        2 * data[i + w] +
        data[i + w + 1];
      out[i] = Math.hypot(gx, gy);
    }
  }
  return { w, h, data: out };
}

/** Edge map: pixels in the top `fraction` of gradient magnitude (and above a floor). */
export function edges(mag: Gray, fraction = 0.08, floor = 40): Uint8Array {
  const vals = Array.from(mag.data).sort((a, b) => b - a);
  const thr = Math.max(floor, vals[Math.min(vals.length - 1, Math.floor(vals.length * fraction))] ?? floor);
  const out = new Uint8Array(mag.w * mag.h);
  for (let i = 0; i < out.length; i++) out[i] = mag.data[i] >= thr ? 1 : 0;
  return out;
}

/** Chamfer 3-4 distance transform (≈ Euclidean px) to the nearest edge pixel. */
export function distanceTransform(e: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e6;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = e[i] ? 0 : INF;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/** Mean distance (px) of ghost points to the nearest edge; points outside the frame count as `outside`. */
export function chamfer(dt: Float32Array, w: number, h: number, pts: Float32Array, outside = 15): number {
  let s = 0;
  const n = pts.length / 2;
  for (let k = 0; k < n; k++) {
    const x = Math.round(pts[2 * k]);
    const y = Math.round(pts[2 * k + 1]);
    s += x < 0 || y < 0 || x >= w || y >= h ? outside : Math.min(outside, dt[y * w + x]);
  }
  return n ? s / n : outside;
}

/** 0–100: 100 when the ghost sits on edges, ~85 at a mean distance of 1.25 px. */
export const scoreFromChamfer = (mean: number): number => Math.max(0, Math.min(100, 100 - mean * 12));

export function laplacianVariance(g: Gray): number {
  const { w, h, data } = g;
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = data[i - 1] + data[i + 1] + data[i - w] + data[i + w] - 4 * data[i];
      s += l;
      s2 += l * l;
      n++;
    }
  }
  const m = s / n;
  return s2 / n - m * m;
}

export interface MatchResult {
  score: number;
  best: { dx: number; dy: number; s: number; rot: number; score: number };
  sharpness: number;
  brightness: number;
}

export function transformPts(
  pts: Float32Array,
  cx: number,
  cy: number,
  s: number,
  rotDeg: number,
  dx: number,
  dy: number,
): Float32Array {
  const r = (rotDeg * Math.PI) / 180;
  const c = Math.cos(r) * s;
  const sn = Math.sin(r) * s;
  const out = new Float32Array(pts.length);
  for (let k = 0; k < pts.length; k += 2) {
    const x = pts[k] - cx;
    const y = pts[k + 1] - cy;
    out[k] = cx + c * x - sn * y + dx;
    out[k + 1] = cy + sn * x + c * y + dy;
  }
  return out;
}

/** Full match of a frame against ghost edge points (frame px). */
export function matchFrame(rgba: Uint8ClampedArray, w: number, h: number, ghost: Float32Array): MatchResult {
  const g = toGray(rgba, w, h);
  let bright = 0;
  for (let i = 0; i < g.data.length; i++) bright += g.data[i];
  const b = blur3(g);
  const dt = distanceTransform(edges(sobel(b)), w, h);
  let cx = 0;
  let cy = 0;
  for (let k = 0; k < ghost.length; k += 2) {
    cx += ghost[k];
    cy += ghost[k + 1];
  }
  cx /= ghost.length / 2 || 1;
  cy /= ghost.length / 2 || 1;
  const score = scoreFromChamfer(chamfer(dt, w, h, ghost));
  let best = { dx: 0, dy: 0, s: 1, rot: 0, score };
  const step = Math.max(3, Math.round(w / 40));
  for (const s of [0.9, 0.95, 1, 1.05, 1.1]) {
    for (const rot of [-8, -4, 0, 4, 8]) {
      for (let dx = -3 * step; dx <= 3 * step; dx += step) {
        for (let dy = -3 * step; dy <= 3 * step; dy += step) {
          const sc = scoreFromChamfer(chamfer(dt, w, h, transformPts(ghost, cx, cy, s, rot, dx, dy)));
          if (sc > best.score + 0.5) best = { dx, dy, s, rot, score: sc };
        }
      }
    }
  }
  return { score, best, sharpness: laplacianVariance(g), brightness: bright / g.data.length };
}

export type Hint =
  | 'hold'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'closer'
  | 'farther'
  | 'rotateCw'
  | 'rotateCcw'
  | 'dark'
  | 'blurry'
  | 'search';

/** One short instruction from a match result (the camera, not the part, should move). */
export function hintFor(m: MatchResult, w: number): Hint {
  if (m.brightness < 45) return 'dark';
  if (m.best.score < 40) return 'search';
  const gain = m.best.score - m.score;
  if (gain > 6) {
    const shift = Math.hypot(m.best.dx, m.best.dy) / w;
    const scaleOff = Math.abs(m.best.s - 1);
    const rotOff = Math.abs(m.best.rot) / 90;
    const biggest = Math.max(shift, scaleOff, rotOff);
    if (biggest === scaleOff) return m.best.s > 1 ? 'farther' : 'closer';
    if (biggest === rotOff) return m.best.rot > 0 ? 'rotateCw' : 'rotateCcw';
    if (Math.abs(m.best.dx) >= Math.abs(m.best.dy)) return m.best.dx > 0 ? 'right' : 'left';
    return m.best.dy > 0 ? 'down' : 'up';
  }
  if (m.sharpness < 25) return 'blurry';
  return 'hold';
}
