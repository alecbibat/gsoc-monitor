import { create } from 'zustand';

export type GoesWindow = 60 | 120 | 180;

// The three geostationary GeoColor feeds NASA GIBS carries, each assigned a
// non-overlapping longitude slice so the mosaic never double-draws (and never
// needs an antimeridian-crossing Cesium rectangle — GOES-West and Himawari
// discs both straddle it, their slices don't). Slice boundaries sit at the
// midpoint between neighboring sub-satellite longitudes (−106.2° between
// GOES-West at −137.2° and GOES-East at −75.2°), so each pixel comes from the
// satellite viewing it most nearly straight down; the outer edges are the
// discs' ±81.3° visibility limits. GIBS carries no Meteosat feed, which leaves
// the Europe/Africa/Indian-Ocean gap between 6°E and 59°E uncovered.
export interface GoesSat {
  id: 'east' | 'west' | 'himawari';
  label: string;
  gibsLayer: string;
  west: number;
  south: number;
  east: number;
  north: number;
}

export const GOES_SATS: GoesSat[] = [
  {
    id: 'east',
    label: 'GOES-East',
    gibsLayer: 'GOES-East_ABI_GeoColor',
    west: -106.2,
    south: -81.3,
    east: 6.1,
    north: 81.3,
  },
  {
    id: 'west',
    label: 'GOES-West',
    gibsLayer: 'GOES-West_ABI_GeoColor',
    west: -180,
    south: -81.3,
    east: -106.2,
    north: 81.3,
  },
  {
    id: 'himawari',
    label: 'Himawari',
    gibsLayer: 'Himawari_AHI_GeoColor',
    west: 59.4,
    south: -81.3,
    east: 180,
    north: 81.3,
  },
];

interface GoesState {
  frames: number[]; // epoch seconds, 10-min cadence, oldest → newest
  source: 'gibs' | 'estimated' | null;
  windowMinutes: GoesWindow;
  currentIndex: number;
  playing: boolean;
  opacity: number;
  error: string | null;
  setManifest: (frames: number[], source: 'gibs' | 'estimated') => void;
  setWindowMinutes: (m: GoesWindow) => void;
  setCurrentIndex: (i: number) => void;
  setPlaying: (p: boolean) => void;
  setOpacity: (o: number) => void;
  setError: (e: string | null) => void;
}

// The frame list only changes when GIBS publishes a new scan (~10 min);
// skipping identical manifests keeps the 2-min poll from tearing down and
// re-downloading the whole imagery-layer stack (same trick as radarStore).
const manifestSig = (frames: number[], source: string | null) =>
  `${source}|${frames.join(',')}`;

export const useGoesStore = create<GoesState>((set) => ({
  frames: [],
  source: null,
  // Default to a 1h loop: 6 frames × 3 satellite slices is a light stack, and
  // an hour of motion already reads clearly at global zoom.
  windowMinutes: 60,
  currentIndex: 0,
  playing: true,
  // Full opacity: GeoColor is the earth itself — dimming it just mixes in the
  // basemap cartography. The slider is there for operators who want both.
  opacity: 1,
  error: null,
  setManifest: (frames, source) =>
    set((s) =>
      manifestSig(frames, source) === manifestSig(s.frames, s.source)
        ? { error: null }
        : { frames, source, error: null }
    ),
  setWindowMinutes: (m) => set({ windowMinutes: m }),
  setCurrentIndex: (i) => set({ currentIndex: i }),
  setPlaying: (playing) => set({ playing }),
  setOpacity: (opacity) => set({ opacity }),
  setError: (error) => set({ error }),
}));

// The trailing slice of the timeline covered by the selected window
// (10-minute cadence, same count convention as the radar layer).
export function goesFramesInWindow(frames: number[], windowMinutes: number): number[] {
  const count = Math.max(1, Math.round(windowMinutes / 10));
  return frames.slice(Math.max(0, frames.length - count));
}
