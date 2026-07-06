import { create } from 'zustand';

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
  windowMinutes: LightningWindow;
  history: HistoryStatus;
  setStatus: (
    partial: Partial<Pick<LightningStatusState, 'connected' | 'ratePerMin' | 'error'>>
  ) => void;
  setWindow: (m: LightningWindow) => void;
  setHistory: (partial: Partial<HistoryStatus>) => void;
}

export const useLightningStatus = create<LightningStatusState>((set) => ({
  connected: false,
  ratePerMin: 0,
  error: null,
  windowMinutes: 60,
  history: { count: 0, coverageMin: 0, thinned: false, loading: false, error: false },
  setStatus: (partial) => set(partial),
  setWindow: (windowMinutes) => set({ windowMinutes }),
  setHistory: (partial) => set((prev) => ({ history: { ...prev.history, ...partial } })),
}));
