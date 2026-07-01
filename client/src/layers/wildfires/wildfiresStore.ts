import { create } from 'zustand';

interface WildfiresStatusState {
  count: number; // named active incidents drawn
  error: string | null;
  setStatus: (partial: Partial<Pick<WildfiresStatusState, 'count' | 'error'>>) => void;
}

export const useWildfiresStatus = create<WildfiresStatusState>((set) => ({
  count: 0,
  error: null,
  setStatus: (partial) => set(partial),
}));
