// Per-feature tolerance (§7.5) and repeat samples (§7.7), keyed by `${toolId}:${label}`.
import { create } from 'zustand';
import type { Tolerance } from '../core/tolerance';

export interface FeatureExtra {
  tol?: Tolerance;
  repeats?: number[];
}

interface ExtrasStore {
  map: Record<string, FeatureExtra>;
  setTol(key: string, tol: Tolerance | undefined): void;
  addRepeat(key: string, v: number): void;
  clearRepeats(key: string): void;
}

export const useExtras = create<ExtrasStore>((set) => ({
  map: {},
  setTol: (key, tol) => set((s) => ({ map: { ...s.map, [key]: { ...s.map[key], tol } } })),
  addRepeat: (key, v) =>
    set((s) => ({
      map: { ...s.map, [key]: { ...s.map[key], repeats: [...(s.map[key]?.repeats ?? []), v].slice(-10) } },
    })),
  clearRepeats: (key) => set((s) => ({ map: { ...s.map, [key]: { ...s.map[key], repeats: undefined } } })),
}));

export const extraKey = (toolId: string | null, label: string): string => `${toolId}:${label}`;
