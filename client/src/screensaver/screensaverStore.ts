import { create } from 'zustand';

export interface Poi {
  title: string;
  description: string;
  lat: number;
  lon: number;
  altitudeM: number;
  category: 'earthquake' | 'weather' | 'landmark' | 'hurricane';
}

type Phase = 'rotating' | 'flying-to' | 'at-poi' | 'flying-back';

interface ScreensaverState {
  active: boolean;
  phase: Phase;
  currentPoi: Poi | null;
  toggle: () => void;
  setPhase: (p: Phase) => void;
  setCurrentPoi: (poi: Poi | null) => void;
}

export const useScreensaverStore = create<ScreensaverState>((set) => ({
  active: false,
  phase: 'rotating',
  currentPoi: null,
  toggle: () => set((s) => ({ active: !s.active, phase: 'rotating', currentPoi: null })),
  setPhase: (phase) => set({ phase }),
  setCurrentPoi: (currentPoi) => set({ currentPoi }),
}));
