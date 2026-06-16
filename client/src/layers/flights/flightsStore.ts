import { create } from 'zustand';

interface FlightsStatusState {
  tooWideView: boolean;
  count: number;
  error: string | null;
  setStatus: (
    partial: Partial<Pick<FlightsStatusState, 'tooWideView' | 'count' | 'error'>>
  ) => void;
}

export const useFlightsStatus = create<FlightsStatusState>((set) => ({
  tooWideView: false,
  count: 0,
  error: null,
  setStatus: (partial) => set(partial),
}));
