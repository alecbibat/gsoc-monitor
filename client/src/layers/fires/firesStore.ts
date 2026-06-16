import { create } from 'zustand';

interface FiresStatusState {
  count: number;
  capped: boolean; // true when more hotspots exist than we drew
  error: string | null;
  setStatus: (
    partial: Partial<Pick<FiresStatusState, 'count' | 'capped' | 'error'>>
  ) => void;
}

export const useFiresStatus = create<FiresStatusState>((set) => ({
  count: 0,
  capped: false,
  error: null,
  setStatus: (partial) => set(partial),
}));
