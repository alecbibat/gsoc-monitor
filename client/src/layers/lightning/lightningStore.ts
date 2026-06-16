import { create } from 'zustand';

interface LightningStatusState {
  connected: boolean;
  ratePerMin: number;
  error: string | null;
  setStatus: (
    partial: Partial<Pick<LightningStatusState, 'connected' | 'ratePerMin' | 'error'>>
  ) => void;
}

export const useLightningStatus = create<LightningStatusState>((set) => ({
  connected: false,
  ratePerMin: 0,
  error: null,
  setStatus: (partial) => set(partial),
}));
