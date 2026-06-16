import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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

export interface CustomSource {
  url: string;
  label: string;
}

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
  customSources: CustomSource[];
  setData: (items: NewsItem[], updated: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  toggleSeverity: (s: SeverityFilter) => void;
  toggleCategory: (c: CategoryFilter) => void;
  addCustomSource: (source: CustomSource) => void;
  removeCustomSource: (url: string) => void;
}

export const useNewsStore = create<NewsState>()(
  persist(
    (set) => ({
      items: [],
      updated: null,
      loading: false,
      error: null,
      severityFilter: new Set(ALL_SEVERITIES),
      categoryFilter: new Set(ALL_CATEGORIES),
      seenIds: new Set(),
      customSources: [],
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
      addCustomSource: (source) =>
        set((s) => {
          if (s.customSources.some((c) => c.url === source.url)) return s;
          return { customSources: [...s.customSources, source] };
        }),
      removeCustomSource: (url) =>
        set((s) => ({ customSources: s.customSources.filter((c) => c.url !== url) })),
    }),
    {
      name: 'gsoc-news',
      partialize: (state) => ({ customSources: state.customSources }),
    }
  )
);
