import { create } from 'zustand';

interface FlightsStatusState {
  tooWideView: boolean;
  count: number;
  setStatus: (partial: Partial<Pick<FlightsStatusState, 'tooWideView' | 'count'>>) => void;
}

export const useFlightsStatus = create<FlightsStatusState>((set) => ({
  tooWideView: false,
  count: 0,
  setStatus: (partial) => set(partial),
}));
