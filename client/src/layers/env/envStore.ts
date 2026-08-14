import { create } from 'zustand';

// Surface-field overlay (Track 4): which scalar the raster shows. Isobars are
// an independent layer toggle and don't read this.
export type EnvField = 'temp' | 'rh';

interface EnvState {
  field: EnvField;
  setField: (f: EnvField) => void;
  // Sidebar status line, set by the layer ("updated 12m ago", error text).
  status: string | null;
  setStatus: (s: string | null) => void;
}

export const useEnvStore = create<EnvState>((set) => ({
  field: 'temp',
  setField: (field) => set({ field }),
  status: null,
  setStatus: (status) => set({ status }),
}));
