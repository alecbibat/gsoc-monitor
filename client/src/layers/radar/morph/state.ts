import { create } from 'zustand';

// Coordination between the morph renderer and the imagery-layer pipeline:
// while the morph sheet owns the radar, the per-frame imagery layers drop to
// zero alpha (they stay loaded for an instant fallback when the camera moves
// or the sheet can't run).
interface MorphState {
  active: boolean;
  setActive: (a: boolean) => void;
}

export const useMorphStore = create<MorphState>((set) => ({
  active: false,
  setActive: (active) => set((s) => (s.active === active ? {} : { active })),
}));
