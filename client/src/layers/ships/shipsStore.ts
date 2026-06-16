import { create } from 'zustand';

interface ShipsStatusState {
  count: number;
  total: number; // allowlist size (7)
  error: string | null;
  noKey: boolean;
  connected: boolean;
  setStatus: (
    partial: Partial<Pick<ShipsStatusState, 'count' | 'total' | 'error' | 'noKey' | 'connected'>>
  ) => void;
}

export const useShipsStatus = create<ShipsStatusState>((set) => ({
  count: 0,
  total: 7,
  error: null,
  noKey: false,
  connected: false,
  setStatus: (partial) => set(partial),
}));
