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
    // The dedup set otherwise grows for the life of the page while the feed it
    // protects is capped at FEED_CAP. Trim from the oldest insertions, but keep
    // well more than one scan's worth so events that just fell off the cap
    // aren't re-announced as new.
    if (seen.size > 5000) {
      const excess = seen.size - 5000;
      let i = 0;
      for (const id of seen) {
        if (i++ >= excess) break;
        seen.delete(id);
      }
    }
    set({
      groups: scan.groups,
      updated: scan.updated,
      errors: scan.errors,
      feed: [...fresh, ...feed].slice(0, FEED_CAP),
      loading: false,
    });
  },
}));
