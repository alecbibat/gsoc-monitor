import { create } from 'zustand';

// Surface-field overlay (Track 4): which scalar the raster shows. Isobars are
// an independent layer toggle and don't read this.
export type EnvField = 'temp' | 'rh';

interface EnvState {
  field: EnvField;
  setField: (f: EnvField) => void;
  // Per-toggle sidebar status lines — the two layers share one grid but must
  // not overwrite each other's label (last-writer-wins mislabeled both rows).
  isobarStatus: string | null;
  setIsobarStatus: (s: string | null) => void;
  fieldStatus: string | null;
  setFieldStatus: (s: string | null) => void;
}

export const useEnvStore = create<EnvState>((set) => ({
  field: 'temp',
  setField: (field) => set({ field }),
  isobarStatus: null,
  setIsobarStatus: (isobarStatus) => set({ isobarStatus }),
  fieldStatus: null,
  setFieldStatus: (fieldStatus) => set({ fieldStatus }),
}));
