import { create } from 'zustand';

interface ShipsStatusState {
  count: number;
  total: number; // allowlist size (7)
  error: string | null;
  noKey: boolean;
  connected: boolean;
  streaming: boolean; // AIS messages flowing right now
  messages: number; // total messages seen since boot
  matched: number; // allowlisted ships correlated to a live MMSI
  setStatus: (
    partial: Partial<
      Pick<
        ShipsStatusState,
        'count' | 'total' | 'error' | 'noKey' | 'connected' | 'streaming' | 'messages' | 'matched'
      >
    >
  ) => void;
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
  setStatus: (partial) => set(partial),
}));
