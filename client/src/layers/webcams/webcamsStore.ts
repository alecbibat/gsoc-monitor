import { create } from 'zustand';

interface WebcamsStatusState {
  count: number;
  noKey: boolean;
  error: string | null;
  setStatus: (partial: Partial<Pick<WebcamsStatusState, 'count' | 'noKey' | 'error'>>) => void;
}

// Status surfaced in the sidebar toggle (count / no-key hint / error).
export const useWebcamsStatus = create<WebcamsStatusState>((set) => ({
  count: 0,
  noKey: false,
  error: null,
  setStatus: (partial) => set((s) => ({ ...s, ...partial })),
}));
