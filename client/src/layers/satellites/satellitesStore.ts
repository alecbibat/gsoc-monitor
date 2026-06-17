import { create } from 'zustand';

interface SatellitesStatusState {
  loading: boolean;
  count: number; // satellites currently rendered
  total: number; // satellites available in the fetched set
  error: string | null;
  // Bumped whenever the user asks to track the ISS; the layer watches this and
  // flies to / opens the station once its TLE set is loaded.
  focusNonce: number;
  setStatus: (
    partial: Partial<Pick<SatellitesStatusState, 'loading' | 'count' | 'total' | 'error'>>
  ) => void;
  requestFocusIss: () => void;
}

export const useSatellitesStatus = create<SatellitesStatusState>((set) => ({
  loading: false,
  count: 0,
  total: 0,
  error: null,
  focusNonce: 0,
  setStatus: (partial) => set(partial),
  requestFocusIss: () => set({ focusNonce: Date.now() }),
}));
