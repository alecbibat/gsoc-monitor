import { create } from 'zustand';

interface SmokeState {
  count: number;
  date: string;
  error: string | null;
  setStatus: (partial: Partial<Pick<SmokeState, 'count' | 'date' | 'error'>>) => void;
}

export const useSmokeStatus = create<SmokeState>()((set) => ({
  count: 0,
  date: '',
  error: null,
  setStatus: (partial) => set((s) => ({ ...s, ...partial })),
}));
