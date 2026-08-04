import { create } from 'zustand';

interface IqairState {
  count: number; // cities on the map
  worstAqi: number;
  worstCity: string; // e.g. "Delhi, India"
  noKey: boolean; // IQAIR_API_KEY missing server-side
  sweeping: boolean; // server refresh sweep in progress
  error: string | null;
  setStatus: (partial: Partial<Omit<IqairState, 'setStatus'>>) => void;
}

export const useIqairStatus = create<IqairState>()((set) => ({
  count: 0,
  worstAqi: 0,
  worstCity: '',
  noKey: false,
  sweeping: false,
  error: null,
  setStatus: (partial) => set((s) => ({ ...s, ...partial })),
}));
