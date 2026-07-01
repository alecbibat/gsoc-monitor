import { create } from 'zustand';

interface OutagesStatusState {
  count: number; // active outages drawn
  customers: number; // total impacted customers
  error: string | null;
  setStatus: (partial: Partial<Pick<OutagesStatusState, 'count' | 'customers' | 'error'>>) => void;
}

export const useOutagesStatus = create<OutagesStatusState>((set) => ({
  count: 0,
  customers: 0,
  error: null,
  setStatus: (partial) => set(partial),
}));
