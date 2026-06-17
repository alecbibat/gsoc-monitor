import { create } from 'zustand';

interface OsmStatusState {
  loading: boolean;
  // True once the OSM Buildings tileset has been added to the scene, so the
  // pins screensaver knows real 3D geometry is available for close orbits.
  ready: boolean;
  error: string | null;
  setStatus: (partial: Partial<Pick<OsmStatusState, 'loading' | 'ready' | 'error'>>) => void;
}

export const useOsmStatus = create<OsmStatusState>((set) => ({
  loading: false,
  ready: false,
  error: null,
  setStatus: (partial) => set(partial),
}));
