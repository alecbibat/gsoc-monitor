import { create } from 'zustand';

export interface Poi {
  title: string;
  description: string;
  lat: number;
  lon: number;
  altitudeM: number;
  category: 'earthquake' | 'weather' | 'landmark' | 'hurricane' | 'park' | 'news' | 'iss';
  imageUrl?: string | null;
  url?: string;
}

export type ScreensaverMode = 'global' | 'national-parks' | 'iss';

type Phase = 'rotating' | 'flying-to' | 'at-poi' | 'flying-back';

interface ScreensaverState {
  active: boolean;
  mode: ScreensaverMode;
  phase: Phase;
  currentPoi: Poi | null;
  newsPoiQueue: Poi[];
  toggle: (mode: ScreensaverMode) => void;
  setPhase: (p: Phase) => void;
  setCurrentPoi: (poi: Poi | null) => void;
  enqueueNewsPoi: (poi: Poi) => void;
  dequeueNewsPoi: () => Poi | undefined;
}

export const useScreensaverStore = create<ScreensaverState>((set, get) => ({
  active: false,
  mode: 'global',
  phase: 'rotating',
  currentPoi: null,
  newsPoiQueue: [],
  toggle: (mode) =>
    set((s) => {
      if (s.active && s.mode === mode) {
        // Same button pressed again — turn off.
        return { active: false, phase: 'rotating', currentPoi: null, newsPoiQueue: [] };
      }
      // Switch to (or start) the requested mode.
      return { active: true, mode, phase: 'rotating', currentPoi: null, newsPoiQueue: [] };
    }),
  setPhase: (phase) => set({ phase }),
  setCurrentPoi: (currentPoi) => set({ currentPoi }),
  enqueueNewsPoi: (poi) => set((s) => ({ newsPoiQueue: [...s.newsPoiQueue, poi] })),
  dequeueNewsPoi: () => {
    const { newsPoiQueue } = get();
    if (newsPoiQueue.length === 0) return undefined;
    const [next, ...rest] = newsPoiQueue;
    set({ newsPoiQueue: rest });
    return next;
  },
}));
