// Camera match worker (§10.5): runs the chamfer matcher off the main thread.
import { matchFrame } from '../core/vision';

interface FrameMsg {
  id: number;
  w: number;
  h: number;
  data: Uint8ClampedArray;
  ghost: Float32Array;
}

self.onmessage = (e: MessageEvent<FrameMsg>) => {
  const { id, w, h, data, ghost } = e.data;
  const t0 = performance.now();
  const r = matchFrame(data, w, h, ghost);
  (self as unknown as Worker).postMessage({ id, ...r, ms: performance.now() - t0 });
};
