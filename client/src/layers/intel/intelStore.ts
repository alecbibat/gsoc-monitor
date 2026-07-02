import { create } from 'zustand';
import type { IntelCategory, IntelItem } from '../../types';

// Shared state for the OSINT intel feed. Both the map layer and the dockable
// widget poll /api/intel into here, so whichever is visible keeps the buffer
// warm and they never disagree. Raw `items` are kept unfiltered; the category
// filter is applied at render time in each consumer.
interface IntelState {
  items: IntelItem[];
  updated: number;
  sourceCount: number;
  errors: string[];
  loading: boolean;
  error: string | null;
  // Category filter (empty set = show all). Persisted only in memory.
  categories: Set<IntelCategory>;
  toggleCategory: (c: IntelCategory) => void;
  setData: (items: IntelItem[], updated: number, sourceCount: number, errors: string[]) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useIntelStore = create<IntelState>((set) => ({
  items: [],
  updated: 0,
  sourceCount: 0,
  errors: [],
  loading: false,
  error: null,
  categories: new Set(),
  toggleCategory: (c) =>
    set((s) => {
      const next = new Set(s.categories);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return { categories: next };
    }),
  // The layer and the widget each poll /api/intel; guard against an in-flight
  // slow response landing after a newer one and regressing the feed.
  setData: (items, updated, sourceCount, errors) =>
    set((s) =>
      updated >= s.updated
        ? { items, updated, sourceCount, errors, loading: false, error: null }
        : { loading: false }
    ),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e, loading: false }),
}));

// Category presentation shared by the layer (pin tint) and widget (chips).
export const CATEGORY_META: Record<IntelCategory, { label: string; icon: string; color: string }> = {
  scanner: { label: 'Scanner', icon: '📟', color: '#38bdf8' },
  crime: { label: 'Crime', icon: '🚔', color: '#f472b6' },
  crash: { label: 'Crash', icon: '🚗', color: '#fb923c' },
  fire: { label: 'Fire', icon: '🔥', color: '#ef4444' },
  weather: { label: 'Weather', icon: '🌩', color: '#a78bfa' },
  news: { label: 'News', icon: '📰', color: '#818cf8' },
  social: { label: 'Social', icon: '💬', color: '#2dd4bf' },
  other: { label: 'Other', icon: '📍', color: '#94a3b8' },
};
