import { create } from 'zustand';

// Status surfaced in the sidebar for the animated wind layer. The layer is a
// particle animation over a fetched grid (no per-feature data), so the status is
// a ready/error flag plus the peak wind speed in the current field.
interface WindState {
  ready: boolean;
  error: string | null;
  maxSpeedMps: number;
  setStatus: (partial: Partial<Omit<WindState, 'setStatus'>>) => void;
}

export const useWindStatus = create<WindState>((set) => ({
  ready: false,
  error: null,
  maxSpeedMps: 0,
  setStatus: (partial) => set((s) => ({ ...s, ...partial })),
}));
