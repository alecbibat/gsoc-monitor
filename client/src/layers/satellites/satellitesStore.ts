import { create } from 'zustand';

interface SatellitesStatusState {
  loading: boolean;
  count: number; // satellites currently rendered
  total: number; // satellites available in the fetched set
  error: string | null;
  setStatus: (
    partial: Partial<Pick<SatellitesStatusState, 'loading' | 'count' | 'total' | 'error'>>
  ) => void;
}

export const useSatellitesStatus = create<SatellitesStatusState>((set) => ({
  loading: false,
  count: 0,
  total: 0,
  error: null,
  setStatus: (partial) => set(partial),
}));
