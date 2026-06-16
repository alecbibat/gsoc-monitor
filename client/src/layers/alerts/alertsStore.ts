import { create } from 'zustand';

interface AlertsStatusState {
  count: number;
  error: string | null;
  setStatus: (partial: Partial<Pick<AlertsStatusState, 'count' | 'error'>>) => void;
}

export const useAlertsStatus = create<AlertsStatusState>((set) => ({
  count: 0,
  error: null,
  setStatus: (partial) => set(partial),
}));
