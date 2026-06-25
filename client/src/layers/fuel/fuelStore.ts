import { create } from 'zustand';

// Status surfaced in the sidebar for the LANDFIRE fuel-model raster overlay.
// The layer is a single colorized imagery overlay (no per-feature data), so the
// status is just a ready/error flag rather than a feature count.
interface FuelState {
  ready: boolean;
  error: string | null;
  setStatus: (partial: Partial<Omit<FuelState, 'setStatus'>>) => void;
}

export const useFuelStatus = create<FuelState>((set) => ({
  ready: false,
  error: null,
  setStatus: (partial) => set((s) => ({ ...s, ...partial })),
}));
