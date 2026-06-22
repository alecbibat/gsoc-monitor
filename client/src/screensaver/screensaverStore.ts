import { create } from 'zustand';

export interface Poi {
  title: string;
  description: string;
  lat: number;
  lon: number;
  altitudeM: number;
  category: 'earthquake' | 'weather' | 'landmark' | 'hurricane' | 'park' | 'news' | 'iss' | 'pin' | 'ship';
  imageUrl?: string | null;
  url?: string;
  meta?: Record<string, unknown>;
}

export type ScreensaverMode = 'global' | 'national-parks' | 'iss' | 'pins';

type Phase = 'rotating' | 'flying-to' | 'at-poi' | 'flying-back';

interface ScreensaverState {
  active: boolean;
  mode: ScreensaverMode;
  phase: Phase;
  currentPoi: Poi | null;
  newsPoiQueue: Poi[];
  voiceEnabled: boolean;
  toggle: (mode: ScreensaverMode) => void;
  stop: () => void;
  setPhase: (p: Phase) => void;
  setCurrentPoi: (poi: Poi | null) => void;
  enqueueNewsPoi: (poi: Poi) => void;
  dequeueNewsPoi: () => Poi | undefined;
  toggleVoice: () => void;
}

function loadVoicePref(): boolean {
  try { return localStorage.getItem('ss-voice') === '1'; } catch { return false; }
}

export const useScreensaverStore = create<ScreensaverState>((set, get) => ({
  active: false,
  mode: 'global',
  phase: 'rotating',
  currentPoi: null,
  newsPoiQueue: [],
  voiceEnabled: loadVoicePref(),
  toggle: (mode) =>
    set((s) => {
      if (s.active && s.mode === mode) {
        // Same button pressed again — turn off.
        return { active: false, phase: 'rotating', currentPoi: null, newsPoiQueue: [] };
      }
      // Switch to (or start) the requested mode.
      return { active: true, mode, phase: 'rotating', currentPoi: null, newsPoiQueue: [] };
    }),
  stop: () => set({ active: false, phase: 'rotating', currentPoi: null, newsPoiQueue: [] }),
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
  toggleVoice: () =>
    set((s) => {
      const next = !s.voiceEnabled;
      try { localStorage.setItem('ss-voice', next ? '1' : '0'); } catch {}
      if (!next) { try { window.speechSynthesis?.cancel(); } catch {} }
      return { voiceEnabled: next };
    }),
}));
