import { create } from 'zustand';

interface WarnStatusState {
  /** WEAs drawn. */
  count: number;
  /** NWS-issued WEAs left out by the "hide NWS" option. */
  hiddenNws: number;
  /** When PBS's backend last checked in, per the last response. */
  heartbeat: string | null;
  /** When the server last fetched from PBS. */
  fetchedAt: string | null;
  error: string | null;
  setStatus: (partial: Partial<Pick<WarnStatusState, 'count' | 'hiddenNws' | 'heartbeat' | 'fetchedAt' | 'error'>>) => void;
}

export const useWarnStatus = create<WarnStatusState>((set) => ({
  count: 0,
  hiddenNws: 0,
  heartbeat: null,
  fetchedAt: null,
  error: null,
  setStatus: (partial) => set(partial),
}));
