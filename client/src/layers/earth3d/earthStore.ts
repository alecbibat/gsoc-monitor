import { create } from 'zustand';

interface EarthStatusState {
  loading: boolean;
  // True only once the photorealistic tileset has been added to the scene, so
  // other features (e.g. the pins screensaver) know 3D geometry is available.
  ready: boolean;
  error: string | null;
  setStatus: (partial: Partial<Pick<EarthStatusState, 'loading' | 'ready' | 'error'>>) => void;
}

export const useEarthStatus = create<EarthStatusState>((set) => ({
  loading: false,
  ready: false,
  error: null,
  setStatus: (partial) => set(partial),
}));
