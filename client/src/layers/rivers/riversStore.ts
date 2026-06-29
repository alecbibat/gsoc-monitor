import { create } from 'zustand';
import type { FloodCat } from '../../types';
import type { RiverFilter } from './riverMeta';

// Sidebar status + the (client-side) flood filter for the rivers layer.
interface RiversState {
  filter: RiverFilter; // minimum flood tier to show
  showForecast: boolean; // also surface gauges forecast to worsen into flood
  counts: Record<FloodCat, number> | null; // national counts from the last fetch
  total: number; // points currently rendered (after filter)
  error: string | null;
  setFilter: (f: RiverFilter) => void;
  toggleForecast: () => void;
  setStatus: (p: Partial<Pick<RiversState, 'counts' | 'total' | 'error'>>) => void;
}

export const useRiversStatus = create<RiversState>((set) => ({
  filter: 'all',
  showForecast: false,
  counts: null,
  total: 0,
  error: null,
  setFilter: (filter) => set({ filter }),
  toggleForecast: () => set((s) => ({ showForecast: !s.showForecast })),
  setStatus: (p) => set(p),
}));
