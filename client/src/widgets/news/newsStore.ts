import { create } from 'zustand';
import type { NewsItem } from '../../types';

export type SeverityFilter = 'alert' | 'urgent' | 'critical';
export type CategoryFilter =
  | 'conflict'
  | 'disaster'
  | 'weather'
  | 'politics'
  | 'economy'
  | 'health'
  | 'environment';

const ALL_SEVERITIES = new Set<SeverityFilter>(['alert', 'urgent', 'critical']);
const ALL_CATEGORIES = new Set<CategoryFilter>([
  'conflict', 'disaster', 'weather', 'politics', 'economy', 'health', 'environment',
]);

interface NewsState {
  items: NewsItem[];
  updated: number | null;
  loading: boolean;
  error: string | null;
  severityFilter: Set<SeverityFilter>;
  categoryFilter: Set<CategoryFilter>;
  seenIds: Set<string>;
  setData: (items: NewsItem[], updated: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  toggleSeverity: (s: SeverityFilter) => void;
  toggleCategory: (c: CategoryFilter) => void;
}

export const useNewsStore = create<NewsState>((set) => ({
  items: [],
  updated: null,
  loading: false,
  error: null,
  severityFilter: new Set(ALL_SEVERITIES),
  categoryFilter: new Set(ALL_CATEGORIES),
  seenIds: new Set(),
  setData: (items, updated) =>
    set((s) => {
      const newIds = new Set([...s.seenIds, ...items.map((i) => i.id)]);
      return { items, updated, loading: false, error: null, seenIds: newIds };
    }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  toggleSeverity: (sv) =>
    set((s) => {
      const next = new Set(s.severityFilter);
      next.has(sv) ? next.delete(sv) : next.add(sv);
      return { severityFilter: next };
    }),
  toggleCategory: (c) =>
    set((s) => {
      const next = new Set(s.categoryFilter);
      next.has(c) ? next.delete(c) : next.add(c);
      return { categoryFilter: next };
    }),
}));
