import { describe, expect, it } from 'vitest';
import {
  lineIntersection,
  rotateAbout,
  rayExitT,
  fitShift,
  clipLineToRect,
  normAngle,
  snapAngle,
  distToSegment,
} from '../../src/core/geometry';
import { nextLabel } from '../../src/core/types';

describe('geometry', () => {
  it('intersects lines, including off-screen intersections', () => {
    expect(lineIntersection([0, 0], [1, 0], [5, -5], [0, 1])).toEqual([5, 0]);
    const p = lineIntersection([0, 0], [1, 1], [1000, 0], [-1, 1])!;
    expect(p[0]).toBeCloseTo(500, 9);
    expect(p[1]).toBeCloseTo(500, 9);
    expect(lineIntersection([0, 0], [1, 0], [0, 1], [2, 0])).toBeNull();
  });
  it('rotates about a pivot', () => {
    const p = rotateAbout([2, 1], [1, 1], 90);
    expect(p[0]).toBeCloseTo(1, 12);
    expect(p[1]).toBeCloseTo(2, 12);
  });
  it('rect helpers', () => {
    const r = { x: 0, y: 0, w: 60, h: 140 };
    expect(rayExitT([10, 10], [1, 0], r)).toBe(50);
    expect(
      fitShift(
        [
          [-5, 10],
          [20, 10],
        ],
        r,
      ),
    ).toEqual([5, 0]);
    expect(fitShift([[0, 150]], r)).toEqual([0, -10]);
    expect(clipLineToRect([30, 70], [1, 0], r)).toEqual([-30, 30]);
    expect(clipLineToRect([30, 200], [1, 0], r)).toBeNull();
  });
  it('angles', () => {
    expect(normAngle(190)).toBe(-170);
    expect(normAngle(-180)).toBe(180);
    expect(snapAngle(88.5, 15, 2)).toEqual([90, true]);
    expect(snapAngle(84, 15, 2)).toEqual([84, false]);
    expect(distToSegment([0, 5], [-1, 0], [1, 0])).toBe(5);
  });
  it('auto-labels features', () => {
    expect(nextLabel('length', [])).toBe('L1');
    expect(nextLabel('length', ['L1', 'L2'])).toBe('L3');
    expect(nextLabel('width', ['L1'])).toBe('W1');
  });
});
