import { describe, expect, it } from 'vitest';
import {
  cardCalibration,
  combineAxes,
  axisScale,
  ID1_CARD,
  makeDeviceKey,
  deviceKeyString,
  detectBrowser,
  checkScaleGuard,
  estimateProfile,
  makeTransform,
  isAxisSwapped,
  confidenceFor,
  edgesToCurrent,
  edgesToNatural,
  defaultEdges,
  usableRect,
  profileRelCal,
  type ScreenEnv,
  type CalibrationProfile,
} from '../../src/core/calibration';

const env: ScreenEnv = {
  screenW: 412,
  screenH: 915,
  dpr: 2.625,
  visualScale: 1,
  orientationAngle: 0,
  browser: 'chrome',
};

function profile(over: Partial<CalibrationProfile> = {}): CalibrationProfile {
  return {
    ...estimateProfile(makeDeviceKey(env)),
    id: 'p1',
    name: 'Default',
    method: 'card',
    confidence: 'good',
    pxPerMmX: 16.5,
    pxPerMmY: 16.5,
    baselineMm: { x: ID1_CARD.shortMm, y: ID1_CARD.longMm },
    alignmentErrorPx: 1,
    ...over,
  };
}

describe('calibration math', () => {
  it('card: long edge on Y, short edge on X', () => {
    const r = cardCalibration(53.98 * 16, 85.6 * 16);
    expect(r.pxPerMmX).toBeCloseTo(16, 12);
    expect(r.pxPerMmY).toBeCloseTo(16, 12);
    expect(r.averaged).toBe(true);
  });
  it('averages within 0.5 %, keeps per-axis and warns beyond 1 %', () => {
    const avg = combineAxes(16, 16.05);
    expect(avg.averaged).toBe(true);
    expect(avg.pxPerMmX).toBeCloseTo(16.025, 12);
    const mid = combineAxes(16, 16.12);
    expect(mid.averaged).toBe(false);
    expect(mid.warn).toBe(false);
    const bad = combineAxes(16, 16.4);
    expect(bad.warn).toBe(true);
    expect(bad.pxPerMmX).toBe(16);
    expect(bad.pxPerMmY).toBe(16.4);
  });
  it('rejects invalid input', () => {
    expect(() => axisScale(0, 10)).toThrow();
    expect(() => axisScale(100, 0)).toThrow();
  });
  it('estimate is 160 CSS px per inch', () => {
    const p = estimateProfile(makeDeviceKey({ ...env, dpr: 1 }));
    expect(p.pxPerMmX).toBeCloseTo(160 / 25.4, 12);
    expect(p.confidence).toBe('estimate');
  });
  it('confidence levels', () => {
    expect(confidenceFor('card')).toBe('good');
    expect(confidenceFor('ruler', 0.08)).toBe('excellent');
    expect(confidenceFor('ruler', 0.2)).toBe('good');
    expect(confidenceFor('estimate')).toBe('estimate');
  });
  it('r_cal of a card profile is small', () => {
    expect(profileRelCal(profile())).toBeCloseTo(Math.SQRT2 / (ID1_CARD.shortMm * 16.5), 12);
  });
});

describe('device key', () => {
  it('is orientation independent', () => {
    const a = deviceKeyString(makeDeviceKey(env));
    const b = deviceKeyString(makeDeviceKey({ ...env, screenW: 915, screenH: 412, orientationAngle: 90 }));
    expect(a).toBe(b);
    expect(a).toBe('412x915@2.625||chrome');
  });
  it('detects browsers', () => {
    expect(detectBrowser('Mozilla/5.0 (Linux; Android 14) SamsungBrowser/25.0 Chrome/121')).toBe('samsung');
    expect(detectBrowser('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36')).toBe('chrome');
    expect(detectBrowser('Mozilla/5.0 (iPhone) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('safari');
    expect(detectBrowser('Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0')).toBe(
      'firefox',
    );
    expect(detectBrowser('Mozilla/5.0 Chrome/130 Safari/537.36 EdgA/130')).toBe('edge');
  });
});

describe('scale guard', () => {
  it('passes for a matching profile', () => {
    expect(checkScaleGuard(env, profile()).ok).toBe(true);
  });
  it('blocks pinch zoom even without a profile', () => {
    expect(checkScaleGuard({ ...env, visualScale: 1.5 }, null)).toEqual({ ok: false, reasons: ['zoom'] });
  });
  it('detects DPR, screen ("Display size") and browser changes', () => {
    expect(checkScaleGuard({ ...env, dpr: 3 }, profile()).reasons).toContain('dpr');
    expect(checkScaleGuard({ ...env, screenW: 384, screenH: 832 }, profile()).reasons).toContain('screen');
    expect(checkScaleGuard({ ...env, browser: 'samsung' }, profile()).reasons).toContain('device');
  });
  it('ignores rotation', () => {
    expect(checkScaleGuard({ ...env, screenW: 915, screenH: 412, orientationAngle: 90 }, profile()).ok).toBe(
      true,
    );
  });
});

describe('transform', () => {
  const p = { pxPerMmX: 16, pxPerMmY: 17 };
  it('maps mm to device px with per-axis scale', () => {
    const t = makeTransform(p, 0, 2);
    expect(t.mmToDevicePx([10, 10])).toEqual([160, 170]);
    expect(t.devicePxToMm([160, 170])).toEqual([10, 10]);
    expect(t.mmToCssPx([10, 10])).toEqual([80, 85]);
    expect(t.cssPxToMm([80, 85])).toEqual([10, 10]);
  });
  it('swaps axes in landscape (calibration stored in natural portrait axes)', () => {
    expect(isAxisSwapped(90)).toBe(true);
    expect(isAxisSwapped(270)).toBe(true);
    expect(isAxisSwapped(180)).toBe(false);
    const t = makeTransform(p, 90, 2);
    expect([t.sx, t.sy]).toEqual([17, 16]);
  });
  it('gives px per mm along a direction', () => {
    const t = makeTransform(p, 0, 2);
    expect(t.pxPerMmAlong([1, 0])).toBe(16);
    expect(t.pxPerMmAlong([0, 5])).toBe(17);
    expect(t.pxPerMmAlong([1, 1])).toBeCloseTo(Math.hypot(16, 17) / Math.SQRT2, 12);
  });
});

describe('edges', () => {
  const e = {
    ...defaultEdges(400, 900, 10),
    top: 1,
    right: 2,
    bottom: 3,
    left: 4,
    exclusions: [{ cx: 200, cy: 20, r: 8 }],
  };
  it('remaps insets on rotation', () => {
    const l = edgesToCurrent(e, 90);
    expect([l.top, l.right, l.bottom, l.left]).toEqual([2, 3, 4, 1]);
    expect([l.refW, l.refH]).toEqual([900, 400]);
    expect(l.exclusions[0]).toEqual({ cx: 20, cy: 200, r: 8 });
    const u = edgesToCurrent(e, 180);
    expect([u.top, u.right, u.bottom, u.left]).toEqual([3, 4, 1, 2]);
    expect(u.exclusions[0]).toEqual({ cx: 200, cy: 880, r: 8 });
  });
  it('round-trips natural ↔ current', () => {
    for (const a of [0, 90, 180, 270]) {
      expect(edgesToNatural(edgesToCurrent(e, a), a)).toEqual(e);
    }
  });
  it('computes the usable rect', () => {
    expect(usableRect(e, 400, 900)).toEqual({ x: 4, y: 1, w: 394, h: 896 });
  });
});
