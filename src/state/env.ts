// Screen environment watcher: DPR, screen size, pinch-zoom, orientation (§3.7, §17.5).
import { create } from 'zustand';
import { detectBrowser, deviceKeyString, makeDeviceKey, type ScreenEnv } from '../core/calibration';

interface UAData {
  getHighEntropyValues?(hints: string[]): Promise<{ model?: string }>;
}

let model: string | undefined;

/** Android client hints give the device model (Chrome). Never available on iOS. */
export async function loadModelHint(): Promise<void> {
  try {
    const ua = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
    const v = await ua?.getHighEntropyValues?.(['model']);
    model = v?.model || undefined;
  } catch {
    model = undefined;
  }
}

export function readEnv(): ScreenEnv {
  const o =
    screen.orientation?.angle ?? Number((window as unknown as { orientation?: number }).orientation ?? 0);
  return {
    screenW: screen.width,
    screenH: screen.height,
    dpr: window.devicePixelRatio || 1,
    visualScale: window.visualViewport?.scale ?? 1,
    orientationAngle: ((o % 360) + 360) % 360,
    model,
    browser: detectBrowser(navigator.userAgent),
  };
}

interface EnvStore {
  env: ScreenEnv;
  key: string;
  viewport: { w: number; h: number };
  refresh(): void;
}

function viewport() {
  return { w: window.innerWidth, h: window.innerHeight };
}

export const useEnv = create<EnvStore>((set) => {
  const env = readEnv();
  return {
    env,
    key: deviceKeyString(makeDeviceKey(env)),
    viewport: viewport(),
    refresh() {
      const e = readEnv();
      set({ env: e, key: deviceKeyString(makeDeviceKey(e)), viewport: viewport() });
    },
  };
});

let mql: MediaQueryList | null = null;

function watchDpr(): void {
  mql?.removeEventListener('change', onDpr);
  mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  mql.addEventListener('change', onDpr);
}

function onDpr(): void {
  useEnv.getState().refresh();
  watchDpr();
}

export function startEnvWatch(): void {
  const r = () => useEnv.getState().refresh();
  window.addEventListener('resize', r);
  window.addEventListener('orientationchange', r);
  screen.orientation?.addEventListener?.('change', r);
  window.visualViewport?.addEventListener('resize', r);
  watchDpr();
  r();
}
