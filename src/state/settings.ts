// User settings (§14), persisted to IndexedDB.
import { create } from 'zustand';
import type { FractionDenominator, LengthUnit } from '../core/units';
import type { SkinId } from '../render/skins';
import type { BackgroundSpec } from '../render/background';
import type { ShieldMode } from '../render/pointer';
import { kvGet, kvSet } from '../db';

export interface Settings {
  unit: LengthUnit;
  fractionDen: FractionDenominator;
  secondaryUnits: boolean;
  showRaw: boolean;
  theme: 'auto' | 'light' | 'dark';
  skin: SkinId;
  largeHandles: boolean;
  leftHanded: boolean;
  snapTicks: boolean;
  snapHalfMm: boolean;
  snapHandles: boolean;
  snapAngles: boolean;
  haptics: boolean;
  shield: ShieldMode;
  keepScreenOn: boolean;
  fullscreen: boolean;
  loupe: boolean;
  loupeZoom: number;
  nudgeStep: 'px' | '0.05';
  canvasLabels: boolean;
  spotlight: boolean;
  /** Camera (§14) */
  autoCapture: boolean;
  matchThreshold: number;
  torchDefault: boolean;
  keepOriginal: boolean;
  photoQuality: number;
  /** Drawing & export (§14) */
  projection: 'first' | 'third';
  paper: 'a4' | 'letter';
  company: string;
  engineer: string;
  /** Batch / inventory mode (§9): Save goes straight to the next "Prefix-NN" record. */
  batch: { on: boolean; prefix: string };
  language: 'en' | 'hi';
  background: BackgroundSpec;
  bgByTool: Record<string, BackgroundSpec>;
  measuredBy: string;
  onboarded: boolean;
  tourDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  unit: 'mm',
  fractionDen: 16,
  secondaryUnits: true,
  showRaw: false,
  theme: 'auto',
  skin: 'steel',
  largeHandles: false,
  leftHanded: false,
  snapTicks: false,
  snapHalfMm: false,
  snapHandles: true,
  snapAngles: true,
  haptics: true,
  shield: 'normal',
  keepScreenOn: true,
  fullscreen: true,
  loupe: true,
  loupeZoom: 4,
  nudgeStep: 'px',
  canvasLabels: false,
  spotlight: true,
  autoCapture: true,
  matchThreshold: 85,
  torchDefault: false,
  keepOriginal: false,
  photoQuality: 0.85,
  projection: 'first',
  paper: 'a4',
  company: '',
  engineer: '',
  batch: { on: false, prefix: 'Part' },
  language: 'en',
  background: { color: '#ffffff', pattern: 'none' },
  bgByTool: {},
  measuredBy: '',
  onboarded: false,
  tourDone: false,
};

interface SettingsStore extends Settings {
  loaded: boolean;
  set(patch: Partial<Settings>): void;
  load(): Promise<void>;
  reset(): void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist(s: Settings, now = false): void {
  if (saveTimer) clearTimeout(saveTimer);
  if (now) void kvSet('settings', s);
  else saveTimer = setTimeout(() => void kvSet('settings', s), 250);
}

function pick(s: SettingsStore): Settings {
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = (s as unknown as Record<string, unknown>)[k];
  return out as unknown as Settings;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,
  set(patch) {
    set(patch);
    // Onboarding flags are written at once so a quick reload never shows the welcome screen again.
    persist(pick(get()), 'onboarded' in patch || 'tourDone' in patch);
  },
  async load() {
    const saved = await kvGet<Partial<Settings>>('settings');
    set({ ...DEFAULT_SETTINGS, ...(saved ?? {}), loaded: true });
  },
  reset() {
    set({ ...DEFAULT_SETTINGS, onboarded: true });
    persist(pick(get()));
  },
}));
