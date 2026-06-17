import { create } from 'zustand';

interface TimeZonesStatusState {
  loading: boolean;
  ready: boolean;
  error: string | null;
  count: number;
  setStatus: (partial: Partial<Omit<TimeZonesStatusState, 'setStatus'>>) => void;
}

export const useTimeZonesStatus = create<TimeZonesStatusState>((set) => ({
  loading: false,
  ready: false,
  error: null,
  count: 0,
  setStatus: (partial) => set(partial),
}));
