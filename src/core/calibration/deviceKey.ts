// Device identity used to key calibration profiles (§5.2) and the scale guard (§3.7).

export interface DeviceKey {
  /** Natural-portrait screen size in CSS px (short side, long side). */
  screenW: number;
  screenH: number;
  dpr: number;
  model?: string;
  browser: string;
}

/** Snapshot of everything that affects the CSS-px → physical mapping. */
export interface ScreenEnv {
  screenW: number;
  screenH: number;
  dpr: number;
  /** visualViewport.scale (1 when not pinch-zoomed). */
  visualScale: number;
  /** screen.orientation.angle: 0 | 90 | 180 | 270. */
  orientationAngle: number;
  model?: string;
  browser: string;
}

export type Browser = 'samsung' | 'edge' | 'firefox' | 'opera' | 'chrome' | 'safari' | 'other';

export function detectBrowser(ua: string): Browser {
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/EdgA?\//i.test(ua)) return 'edge';
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
  if (/OPR\/|Opera/i.test(ua)) return 'opera';
  if (/Chrome|CriOS|Chromium/i.test(ua)) return 'chrome';
  if (/Safari/i.test(ua)) return 'safari';
  return 'other';
}

/** Natural-portrait key: width = short side, height = long side, so rotation does not change it. */
export function makeDeviceKey(env: ScreenEnv): DeviceKey {
  const a = Math.round(env.screenW);
  const b = Math.round(env.screenH);
  return {
    screenW: Math.min(a, b),
    screenH: Math.max(a, b),
    dpr: Math.round(env.dpr * 1000) / 1000,
    model: env.model || undefined,
    browser: env.browser,
  };
}

/** `${screen.width}x${screen.height}@${devicePixelRatio}|${model?}|${browser}` */
export function deviceKeyString(k: DeviceKey): string {
  return `${k.screenW}x${k.screenH}@${k.dpr}|${k.model ?? ''}|${k.browser}`;
}
