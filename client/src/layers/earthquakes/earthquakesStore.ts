import { create } from 'zustand';

interface EarthquakesStatusState {
  count: number;
  error: string | null;
  setStatus: (partial: Partial<Pick<EarthquakesStatusState, 'count' | 'error'>>) => void;
}

export const useEarthquakesStatus = create<EarthquakesStatusState>((set) => ({
  count: 0,
  error: null,
  setStatus: (partial) => set(partial),
}));
