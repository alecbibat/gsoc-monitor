import { create } from 'zustand';

interface HurricanesStatusState {
  count: number;
  disturbances: number; // NHC GTWO areas to watch for development
  invests: number; // JTWC invests (developing areas in the non-NHC basins)
  error: string | null;
  setStatus: (
    partial: Partial<Pick<HurricanesStatusState, 'count' | 'disturbances' | 'invests' | 'error'>>
  ) => void;
}

export const useHurricanesStatus = create<HurricanesStatusState>((set) => ({
  count: 0,
  disturbances: 0,
  invests: 0,
  error: null,
  setStatus: (partial) => set(partial),
}));
