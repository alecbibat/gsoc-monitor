import { create } from 'zustand';

interface AqiState {
  count: number;
  worstAqi: number;
  worstCategory: string;
  noKey: boolean;
  error: string | null;
  setStatus: (partial: Partial<Omit<AqiState, 'setStatus'>>) => void;
}

export const useAqiStatus = create<AqiState>()((set) => ({
  count: 0,
  worstAqi: 0,
  worstCategory: '',
  noKey: false,
  error: null,
  setStatus: (partial) => set((s) => ({ ...s, ...partial })),
}));
