// Calibration profiles, edges, and the active scale for this device (§5).
import { create } from 'zustand';
import {
  checkScaleGuard,
  deviceKeyString,
  estimateProfile,
  makeDeviceKey,
  profileRelCal,
  type CalibrationProfile,
  type EdgeInsets,
  type GuardResult,
  type ScreenEnv,
} from '../core/calibration';
import { db, kvGet, kvSet } from '../db';

interface CalStore {
  profiles: CalibrationProfile[];
  /** Active profile per device key. */
  active: Record<string, string>;
  /** The most recently used real profile on any key (scale-guard reference). */
  lastUsedId: string | null;
  /** Edges per device key (natural portrait CSS px). */
  edges: Record<string, EdgeInsets>;
  /** User chose to continue with the estimate despite a guard mismatch (this session only). */
  guardOverride: boolean;
  loaded: boolean;
  load(): Promise<void>;
  saveProfile(p: CalibrationProfile): Promise<void>;
  removeProfile(id: string): Promise<void>;
  setActive(key: string, id: string): Promise<void>;
  saveEdges(key: string, e: EdgeInsets): Promise<void>;
  setGuardOverride(v: boolean): void;
}

export const useCalibration = create<CalStore>((set, get) => ({
  profiles: [],
  active: {},
  lastUsedId: null,
  edges: {},
  guardOverride: false,
  loaded: false,
  async load() {
    let profiles: CalibrationProfile[];
    try {
      profiles = await db.profiles.orderBy('createdAt').toArray();
    } catch {
      profiles = [];
    }
    const active = (await kvGet<Record<string, string>>('activeProfiles')) ?? {};
    const lastUsedId = (await kvGet<string>('lastUsedProfile')) ?? null;
    const edges = (await kvGet<Record<string, EdgeInsets>>('edges')) ?? {};
    set({ profiles, active, lastUsedId, edges, loaded: true });
  },
  async saveProfile(p) {
    try {
      await db.profiles.put(p);
    } catch {
      /* in-memory only */
    }
    const key = deviceKeyString(p.deviceKey);
    const profiles = [...get().profiles.filter((x) => x.id !== p.id), p];
    const active = { ...get().active, [key]: p.id };
    set({ profiles, active, lastUsedId: p.id, guardOverride: false });
    await kvSet('activeProfiles', active);
    await kvSet('lastUsedProfile', p.id);
  },
  async removeProfile(id) {
    try {
      await db.profiles.delete(id);
    } catch {
      /* ignore */
    }
    const profiles = get().profiles.filter((x) => x.id !== id);
    const active = Object.fromEntries(Object.entries(get().active).filter(([, v]) => v !== id));
    const lastUsedId = get().lastUsedId === id ? (profiles.at(-1)?.id ?? null) : get().lastUsedId;
    set({ profiles, active, lastUsedId });
    await kvSet('activeProfiles', active);
    await kvSet('lastUsedProfile', lastUsedId);
  },
  async setActive(key, id) {
    const active = { ...get().active, [key]: id };
    set({ active, lastUsedId: id, guardOverride: false });
    await kvSet('activeProfiles', active);
    await kvSet('lastUsedProfile', id);
  },
  async saveEdges(key, e) {
    const edges = { ...get().edges, [key]: e };
    set({ edges });
    await kvSet('edges', edges);
  },
  setGuardOverride(v) {
    set({ guardOverride: v });
  },
}));

export interface ScaleState {
  /** Profile used for drawing (estimate when uncalibrated). */
  profile: CalibrationProfile;
  calibrated: boolean;
  guard: GuardResult;
  relCal: number;
}

/** Resolve which scale to use for the current environment and whether measuring is allowed. */
export function resolveScale(
  env: ScreenEnv,
  s: Pick<CalStore, 'profiles' | 'active' | 'lastUsedId' | 'guardOverride'>,
): ScaleState {
  const key = makeDeviceKey(env);
  const keyStr = deviceKeyString(key);
  const forKey = s.profiles.filter((p) => deviceKeyString(p.deviceKey) === keyStr);
  const match = forKey.find((p) => p.id === s.active[keyStr]) ?? forKey.at(-1) ?? null;
  if (match) {
    return {
      profile: match,
      calibrated: true,
      guard: checkScaleGuard(env, match),
      relCal: profileRelCal(match),
    };
  }
  const est = estimateProfile(key);
  const last = s.profiles.find((p) => p.id === s.lastUsedId) ?? null;
  // A calibration exists but for a different display scale → block until recalibrated (§3.7).
  const guard = checkScaleGuard(env, s.guardOverride ? null : last);
  return { profile: est, calibrated: false, guard, relCal: profileRelCal(est) };
}
