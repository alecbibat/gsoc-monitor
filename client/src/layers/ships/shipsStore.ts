import { create } from 'zustand';

interface ShipsStatusState {
  tooWideView: boolean;
  count: number;
  error: string | null;
  noKey: boolean;
  connected: boolean;
  setStatus: (
    partial: Partial<Pick<ShipsStatusState, 'tooWideView' | 'count' | 'error' | 'noKey' | 'connected'>>
  ) => void;
}

export const useShipsStatus = create<ShipsStatusState>((set) => ({
  tooWideView: false,
  count: 0,
  error: null,
  noKey: false,
  connected: false,
  setStatus: (partial) => set(partial),
}));
