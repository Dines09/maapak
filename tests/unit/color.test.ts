import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  luminance,
  deltaE,
  bestBackgroundFor,
  inkFor,
  blend,
  toOklab,
  hsvToHex,
} from '../../src/core/color';

describe('colour', () => {
  it('computes WCAG luminance and contrast', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 6);
    expect(luminance('#000')).toBe(0);
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 6);
    expect(contrastRatio('#777', '#777')).toBeCloseTo(1, 6);
  });
  it('OKLab white is L = 1', () => {
    expect(toOklab('#ffffff')[0]).toBeCloseTo(1, 4);
    expect(deltaE('#123456', '#123456')).toBe(0);
  });
  it('picks a light background for a black bolt and a dark one for a white part', () => {
    const c = ['#ffffff', '#000000', '#808080', '#00b140', '#0047ab', '#ffd400'];
    expect(['#ffffff', '#ffd400']).toContain(bestBackgroundFor('#111111', c));
    expect(bestBackgroundFor('#f5f5f5', c)).toBe('#000000');
  });
  it('ink is the preferred colour only when it reaches 7:1', () => {
    for (const bg of ['#ffffff', '#000000', '#808080', '#00b140', '#0047ab', '#ffd400', '#c0c4c8']) {
      expect(contrastRatio(inkFor(bg), bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(inkFor('#ffffff', '#222222')).toBe('#222222');
    expect(inkFor('#000000', '#222222')).toBe('#ffffff');
  });
  it('blends and converts HSV', () => {
    expect(blend('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(hsvToHex(0, 1, 1)).toBe('#ff0000');
    expect(hsvToHex(120, 1, 1)).toBe('#00ff00');
  });
});
