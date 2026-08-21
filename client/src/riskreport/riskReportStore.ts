import { create } from 'zustand';
import type { RiskTarget, WildfireReportData } from './riskTypes';
import type { FeedProgress, FeedResult, WildfireFeedId } from './feedManifest';

// Open/close + assembly status for the property risk report. The host
// component (RiskReportHost) watches `target` and runs the wildfire assembly;
// results land here so the view is a pure renderer. `feeds` fills in live
// while status is 'loading' — one entry per settled feed (absence = still
// pending) — so the loading screen can show real acquisition progress.
interface RiskReportState {
  target: RiskTarget | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: WildfireReportData | null;
  error: string | null;
  feeds: FeedProgress;

  open: (target: RiskTarget) => void;
  setFeedResult: (id: WildfireFeedId, result: FeedResult) => void;
  setData: (data: WildfireReportData) => void;
  setError: (message: string) => void;
  close: () => void;
}

export const useRiskReportStore = create<RiskReportState>((set) => ({
  target: null,
  status: 'idle',
  data: null,
  error: null,
  feeds: {},

  open: (target) => set({ target, status: 'loading', data: null, error: null, feeds: {} }),
  setFeedResult: (id, result) => set((s) => ({ feeds: { ...s.feeds, [id]: result } })),
  setData: (data) => set({ data, status: 'ready' }),
  setError: (error) => set({ error, status: 'error' }),
  close: () => set({ target: null, status: 'idle', data: null, error: null, feeds: {} }),
}));
