import { create } from 'zustand';

interface HurricanesStatusState {
  count: number;
  error: string | null;
  setStatus: (partial: Partial<Pick<HurricanesStatusState, 'count' | 'error'>>) => void;
}

export const useHurricanesStatus = create<HurricanesStatusState>((set) => ({
  count: 0,
  error: null,
  setStatus: (partial) => set(partial),
}));
