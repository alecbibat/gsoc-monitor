import { create } from 'zustand';

interface HurricanesStatusState {
  count: number;
  disturbances: number; // GTWO areas to watch for development
  error: string | null;
  setStatus: (
    partial: Partial<Pick<HurricanesStatusState, 'count' | 'disturbances' | 'error'>>
  ) => void;
}

export const useHurricanesStatus = create<HurricanesStatusState>((set) => ({
  count: 0,
  disturbances: 0,
  error: null,
  setStatus: (partial) => set(partial),
}));
