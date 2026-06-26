import { create } from 'zustand';

export interface LightningStrike { lat: number; lon: number; t: number; }
const MAX_STORED = 1000;
const TTL_MS = 10 * 60_000; // 10-minute sliding window

// Selectable history windows (minutes) for the server-backed strike history.
export type LightningWindow = 60 | 360 | 720 | 1440;
export const LIGHTNING_WINDOWS: { value: LightningWindow; label: string }[] = [
  { value: 60, label: '1h' },
  { value: 360, label: '6h' },
  { value: 720, label: '12h' },
  { value: 1440, label: '24h' },
];

// Rolling-history readout for the sidebar (filled by the history layer).
interface HistoryStatus {
  count: number; // strikes in the selected window (server-side, pre-thinning)
  coverageMin: number; // how far back the server buffer reaches
  thinned: boolean; // result was sampled down to the transport cap
  loading: boolean;
  error: boolean;
}

interface LightningStatusState {
  connected: boolean;
  ratePerMin: number;
  error: string | null;
  strikes: LightningStrike[];
  windowMinutes: LightningWindow;
  history: HistoryStatus;
  setStatus: (
    partial: Partial<Pick<LightningStatusState, 'connected' | 'ratePerMin' | 'error'>>
  ) => void;
  addStrike: (s: LightningStrike) => void;
  setWindow: (m: LightningWindow) => void;
  setHistory: (partial: Partial<HistoryStatus>) => void;
}

export const useLightningStatus = create<LightningStatusState>((set) => ({
  connected: false,
  ratePerMin: 0,
  error: null,
  strikes: [],
  windowMinutes: 60,
  history: { count: 0, coverageMin: 0, thinned: false, loading: false, error: false },
  setStatus: (partial) => set(partial),
  addStrike: (s) =>
    set((prev) => {
      const cutoff = Date.now() - TTL_MS;
      const next = prev.strikes.filter((x) => x.t > cutoff);
      next.push(s);
      if (next.length > MAX_STORED) next.splice(0, next.length - MAX_STORED);
      return { strikes: next };
    }),
  setWindow: (windowMinutes) => set({ windowMinutes }),
  setHistory: (partial) => set((prev) => ({ history: { ...prev.history, ...partial } })),
}));
