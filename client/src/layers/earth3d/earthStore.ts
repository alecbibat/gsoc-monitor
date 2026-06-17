import { create } from 'zustand';

interface EarthStatusState {
  loading: boolean;
  error: string | null;
  setStatus: (partial: Partial<Pick<EarthStatusState, 'loading' | 'error'>>) => void;
}

export const useEarthStatus = create<EarthStatusState>((set) => ({
  loading: false,
  error: null,
  setStatus: (partial) => set(partial),
}));
