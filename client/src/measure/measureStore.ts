import { create } from 'zustand';

export interface LngLat {
  lon: number;
  lat: number;
}

export type MeasureMode = 'distance' | 'area';

interface MeasureState {
  active: boolean;
  mode: MeasureMode;
  points: LngLat[];
  hover: LngLat | null; // live cursor position for the rubber-band segment
  finished: boolean;
  toggle: () => void;
  setMode: (m: MeasureMode) => void;
  addPoint: (p: LngLat) => void;
  setHover: (p: LngLat | null) => void;
  undo: () => void;
  clear: () => void;
  finish: () => void;
  exit: () => void;
}

export const useMeasureStore = create<MeasureState>((set) => ({
  active: false,
  mode: 'distance',
  points: [],
  hover: null,
  finished: false,
  toggle: () =>
    set((s) =>
      s.active
        ? { active: false, points: [], hover: null, finished: false }
        : { active: true, points: [], hover: null, finished: false }
    ),
  setMode: (mode) => set({ mode, points: [], hover: null, finished: false }),
  addPoint: (p) =>
    set((s) => (s.finished ? s : { points: [...s.points, p] })),
  setHover: (hover) => set({ hover }),
  undo: () => set((s) => ({ points: s.points.slice(0, -1), finished: false })),
  clear: () => set({ points: [], hover: null, finished: false }),
  finish: () => set({ finished: true, hover: null }),
  exit: () => set({ active: false, points: [], hover: null, finished: false }),
}));
