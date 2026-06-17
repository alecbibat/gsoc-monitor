import { create } from 'zustand';
import type { Webcam } from '../../types';

interface WebcamsStatusState {
  count: number;
  statesActive: number; // DOT providers that returned at least one camera
  error: string | null;
  setStatus: (
    partial: Partial<Pick<WebcamsStatusState, 'count' | 'statesActive' | 'error'>>
  ) => void;
}

// Status surfaced in the sidebar toggle (count / active states / error).
export const useWebcamsStatus = create<WebcamsStatusState>((set) => ({
  count: 0,
  statesActive: 0,
  error: null,
  setStatus: (partial) => set((s) => ({ ...s, ...partial })),
}));

interface WebcamsDataState {
  webcams: Webcam[];
  updated: number;
  setWebcams: (webcams: Webcam[]) => void;
}

// The webcam list, shared so the parks-screensaver callouts can reuse whatever
// the layer (or the callouts themselves) last fetched.
export const useWebcamsData = create<WebcamsDataState>((set) => ({
  webcams: [],
  updated: 0,
  setWebcams: (webcams) => set({ webcams, updated: Date.now() }),
}));
