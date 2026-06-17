import { create } from 'zustand';
import type { ShipState } from '../../types';

interface ShipsStatusState {
  count: number;
  total: number; // allowlist size (7)
  error: string | null;
  noKey: boolean;
  connected: boolean;
  streaming: boolean; // AIS messages flowing right now
  messages: number; // total messages seen since boot
  matched: number; // allowlisted ships correlated to a live MMSI
  ships: ShipState[]; // latest fleet positions, for the sidebar roster fly-to
  setStatus: (
    partial: Partial<
      Pick<
        ShipsStatusState,
        'count' | 'total' | 'error' | 'noKey' | 'connected' | 'streaming' | 'messages' | 'matched'
      >
    >
  ) => void;
  setShips: (ships: ShipState[]) => void;
}

export const useShipsStatus = create<ShipsStatusState>((set) => ({
  count: 0,
  total: 7,
  error: null,
  noKey: false,
  connected: false,
  streaming: false,
  messages: 0,
  matched: 0,
  ships: [],
  setStatus: (partial) => set(partial),
  setShips: (ships) => set({ ships }),
}));
