import { create } from 'zustand';

export interface LightningStrike { lat: number; lon: number; t: number; }
const MAX_STORED = 1000;
const TTL_MS = 10 * 60_000; // 10-minute sliding window

interface LightningStatusState {
  connected: boolean;
  ratePerMin: number;
  error: string | null;
  strikes: LightningStrike[];
  setStatus: (
    partial: Partial<Pick<LightningStatusState, 'connected' | 'ratePerMin' | 'error'>>
  ) => void;
  addStrike: (s: LightningStrike) => void;
}

export const useLightningStatus = create<LightningStatusState>((set) => ({
  connected: false,
  ratePerMin: 0,
  error: null,
  strikes: [],
  setStatus: (partial) => set(partial),
  addStrike: (s) =>
    set((prev) => {
      const cutoff = Date.now() - TTL_MS;
      const next = prev.strikes.filter((x) => x.t > cutoff);
      next.push(s);
      if (next.length > MAX_STORED) next.splice(0, next.length - MAX_STORED);
      return { strikes: next };
    }),
}));
