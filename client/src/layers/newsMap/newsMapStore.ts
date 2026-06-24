import { create } from 'zustand';
import type { NewsMapEvent } from '../../types';

// Status + raw data for the News (GDELT) layer. The raw `events` are kept here
// so the layer can re-filter by the near-pins scope without re-hitting GDELT
// when the user flips the radius control.
interface NewsMapState {
  events: NewsMapEvent[]; // unfiltered, as fetched
  count: number; // currently drawn (after scope filter)
  total: number; // total fetched
  updated: number | null;
  error: string | null;
  setEvents: (events: NewsMapEvent[], updated: number | null) => void;
  setStatus: (partial: Partial<Pick<NewsMapState, 'count' | 'error'>>) => void;
}

export const useNewsMapStore = create<NewsMapState>((set) => ({
  events: [],
  count: 0,
  total: 0,
  updated: null,
  error: null,
  setEvents: (events, updated) => set({ events, total: events.length, updated }),
  setStatus: (partial) => set(partial),
}));
