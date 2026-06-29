import { create } from 'zustand';

interface FireOutlookState {
  day: number; // 0..6 → Day 1..7
  count: number; // PSAs rendered
  dates: (string | null)[];
  error: string | null;
  setDay: (d: number) => void;
  setStatus: (p: Partial<Pick<FireOutlookState, 'count' | 'dates' | 'error'>>) => void;
}

export const useFireOutlookStore = create<FireOutlookState>((set) => ({
  day: 0,
  count: 0,
  dates: [],
  error: null,
  setDay: (day) => set({ day }),
  setStatus: (p) => set(p),
}));
