import { create } from 'zustand';
import type { RiskTarget, WildfireReportData } from './riskTypes';
import type { FloodReportData } from './floodTypes';
import type { FeedProgress, FeedResult, RiskFeedId } from './feedManifest';

/** Which canned report a property opens: each hazard has its own assembly. */
export type RiskHazard = 'wildfire' | 'flood';

export type RiskReportData = WildfireReportData | FloodReportData;

// Open/close + assembly status for the property risk report. The host
// component (RiskReportHost) watches `target` and runs the assembly for
// `hazard`; results land here so the view is a pure renderer. `feeds` fills in
// live while status is 'loading' — one entry per settled feed (absence = still
// pending) — so the loading screen can show real acquisition progress.
interface RiskReportState {
  target: RiskTarget | null;
  hazard: RiskHazard;
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: RiskReportData | null;
  error: string | null;
  feeds: FeedProgress;

  /** Opens the report; `hazard` defaults to wildfire, the original report. */
  open: (target: RiskTarget, hazard?: RiskHazard) => void;
  setFeedResult: (id: RiskFeedId, result: FeedResult) => void;
  setData: (data: RiskReportData) => void;
  setError: (message: string) => void;
  close: () => void;
}

export const useRiskReportStore = create<RiskReportState>((set) => ({
  target: null,
  hazard: 'wildfire',
  status: 'idle',
  data: null,
  error: null,
  feeds: {},

  open: (target, hazard = 'wildfire') =>
    set({ target, hazard, status: 'loading', data: null, error: null, feeds: {} }),
  setFeedResult: (id, result) => set((s) => ({ feeds: { ...s.feeds, [id]: result } })),
  setData: (data) => set({ data, status: 'ready' }),
  setError: (error) => set({ error, status: 'error' }),
  close: () => set({ target: null, status: 'idle', data: null, error: null, feeds: {} }),
}));
