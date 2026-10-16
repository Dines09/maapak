// High-frequency state from the stage (readouts once per frame, active handle position).
// Kept out of the screen component so dragging only re-renders the HUD (§16.4).
import { create } from 'zustand';
import type { Vec } from '../core/types';
import type { Readout } from '../render/types';

interface LiveStore {
  readouts: Readout[];
  toolKey: string | null;
  avoid: Vec | null;
  setReadouts(r: Readout[], toolKey: string | null): void;
  setAvoid(p: Vec | null): void;
}

export const useLive = create<LiveStore>((set) => ({
  readouts: [],
  toolKey: null,
  avoid: null,
  setReadouts: (readouts, toolKey) => set({ readouts, toolKey }),
  setAvoid: (avoid) => set({ avoid }),
}));
