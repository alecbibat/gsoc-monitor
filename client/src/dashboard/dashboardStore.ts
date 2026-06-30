import { create } from 'zustand';
import type { DashboardScan, FeedEvent, GroupStatus } from './dashboardData';

const FEED_CAP = 120;

interface DashboardState {
  open: boolean;
  groups: GroupStatus[];
  feed: FeedEvent[];
  seen: Set<string>; // event ids already in the feed (internal dedup)
  updated: number;
  loading: boolean;
  errors: string[];
  setOpen: (o: boolean) => void;
  setLoading: (b: boolean) => void;
  applyScan: (scan: DashboardScan) => void;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  open: false,
  groups: [],
  feed: [],
  seen: new Set(),
  updated: 0,
  loading: false,
  errors: [],
  setOpen: (open) => set({ open }),
  setLoading: (loading) => set({ loading }),
  applyScan: (scan) => {
    const { seen, feed } = get();
    const now = Date.now();
    const fresh: FeedEvent[] = [];
    for (const ev of scan.events) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      // Stamp first-seen time for events without their own timestamp.
      fresh.push({ ...ev, at: ev.at > 0 ? ev.at : now });
    }
    fresh.sort((a, b) => b.at - a.at); // newest first
    set({
      groups: scan.groups,
      updated: scan.updated,
      errors: scan.errors,
      feed: [...fresh, ...feed].slice(0, FEED_CAP),
      loading: false,
    });
  },
}));
