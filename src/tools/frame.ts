// Local tool frame: t along the tool direction u, o along the normal n (n = u rotated −90°, "up").
import type { Vec } from '../core/types';
import { dirOf, dot, sub } from '../core/geometry';

export function frameU(angle: number): Vec {
  return dirOf(angle);
}

export function frameN(angle: number): Vec {
  const u = dirOf(angle);
  return [u[1], -u[0]];
}

/** origin + u·t + n·o */
export function at(origin: Vec, angle: number, t: number, o: number): Vec {
  const u = dirOf(angle);
  return [origin[0] + u[0] * t + u[1] * o, origin[1] + u[1] * t - u[0] * o];
}

/** Inverse of `at`: [t, o] of a point. */
export function toLocal(origin: Vec, angle: number, p: Vec): Vec {
  const d = sub(p, origin);
  return [dot(d, frameU(angle)), dot(d, frameN(angle))];
}
