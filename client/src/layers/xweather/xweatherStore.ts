import { create } from 'zustand';

// Xweather (Vaisala NLDN) lightning raster layer state. The tiles carry a
// 7-day history addressable by time offset, so the layer has a mode (what to
// draw), a window (how many minutes each frame aggregates) and a time (now or
// a past offset). `configured` reflects whether the server holds API keys —
// checked once per activation via /api/xweather/status.

export type XwMode = 'strikes' | 'all' | 'density';
export type XwWindow = '5m' | '15m';

export const XW_TIMES = [
  { value: 'current', label: 'Now' },
  { value: '-1hours', label: '-1h' },
  { value: '-3hours', label: '-3h' },
  { value: '-6hours', label: '-6h' },
  { value: '-12hours', label: '-12h' },
  { value: '-24hours', label: '-24h' },
  { value: '-2days', label: '-2d' },
] as const;
export type XwTime = (typeof XW_TIMES)[number]['value'];

interface XweatherState {
  configured: boolean | null; // null = not yet checked
  mode: XwMode;
  window: XwWindow;
  time: XwTime;
  setConfigured: (configured: boolean) => void;
  setMode: (mode: XwMode) => void;
  setWindow: (window: XwWindow) => void;
  setTime: (time: XwTime) => void;
}

export const useXweatherStore = create<XweatherState>((set) => ({
  configured: null,
  mode: 'strikes',
  window: '15m',
  time: 'current',
  setConfigured: (configured) => set({ configured }),
  setMode: (mode) => set({ mode }),
  setWindow: (window) => set({ window }),
  setTime: (time) => set({ time }),
}));

// The proxy layer code for the current mode/window selection. The -icons
// variants render the balloon strike markers (the Dataminr look); lightning-all
// renders icon markers natively.
export function xwLayerCode(mode: XwMode, window: XwWindow): string {
  if (mode === 'density') return 'lightning-strike-density';
  return mode === 'all' ? `lightning-all-${window}` : `lightning-strikes-${window}-icons`;
}
