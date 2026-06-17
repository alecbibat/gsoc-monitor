import { create } from 'zustand';

interface TrafficStatusState {
  loading: boolean;
  ready: boolean;
  error: string | null;
  incidentCount: number;
  noKey: boolean;
  setStatus: (partial: Partial<Omit<TrafficStatusState, 'setStatus'>>) => void;
}

export const useTrafficStatus = create<TrafficStatusState>((set) => ({
  loading: false,
  ready: false,
  error: null,
  incidentCount: 0,
  noKey: false,
  setStatus: (partial) => set(partial),
}));
