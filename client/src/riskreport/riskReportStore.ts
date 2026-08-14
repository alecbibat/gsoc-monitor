import { create } from 'zustand';
import type { RiskTarget, WildfireReportData } from './riskTypes';

// Open/close + assembly status for the property risk report. The host
// component (RiskReportHost) watches `target` and runs the wildfire assembly;
// results land here so the view is a pure renderer.
interface RiskReportState {
  target: RiskTarget | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: WildfireReportData | null;
  error: string | null;

  open: (target: RiskTarget) => void;
  setData: (data: WildfireReportData) => void;
  setError: (message: string) => void;
  close: () => void;
}

export const useRiskReportStore = create<RiskReportState>((set) => ({
  target: null,
  status: 'idle',
  data: null,
  error: null,

  open: (target) => set({ target, status: 'loading', data: null, error: null }),
  setData: (data) => set({ data, status: 'ready' }),
  setError: (error) => set({ error, status: 'error' }),
  close: () => set({ target: null, status: 'idle', data: null, error: null }),
}));
