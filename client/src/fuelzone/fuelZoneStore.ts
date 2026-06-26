import { create } from 'zustand';
import { useMeasureStore } from '../measure/measureStore';
import type { LngLat } from './zonalStats';

// Draw-a-zone "fuel analysis" tool. One cursor-owning interaction with two
// drawing modes that share the busy/error/seq plumbing:
//
//   circle  → click a center, drag out the radius, second click finalizes
//   polygon → click to drop boundary points; click the first point, double-
//             click, or hit "Finish" to close the ring and analyze
export type ZoneMode = 'circle' | 'polygon';

interface FuelZoneState {
  active: boolean;
  mode: ZoneMode;
  // circle geometry
  center: LngLat | null;
  radiusM: number;
  hasCenter: boolean;
  // polygon geometry
  vertices: LngLat[];
  cursor: LngLat | null; // live rubber-band point (null when off-globe)
  pendingFinish: number; // nonce bumped by the overlay's Finish button
  // shared
  busy: boolean;
  error: string | null;
  seq: number; // increments per completed analysis → unique panel ids

  toggle: (mode?: ZoneMode) => void;
  exit: () => void;
  begin: (center: LngLat) => void;
  setRadius: (m: number) => void;
  addVertex: (p: LngLat) => void;
  undoVertex: () => void;
  setCursor: (p: LngLat | null) => void;
  requestFinish: () => void;
  reset: () => void; // clear geometry but stay in draw mode
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  bumpSeq: () => void;
}

const CLEARED: Pick<
  FuelZoneState,
  'center' | 'radiusM' | 'hasCenter' | 'vertices' | 'cursor' | 'busy' | 'error'
> = {
  center: null,
  radiusM: 0,
  hasCenter: false,
  vertices: [],
  cursor: null,
  busy: false,
  error: null,
};

export const useFuelZoneStore = create<FuelZoneState>((set, get) => ({
  active: false,
  mode: 'circle',
  ...CLEARED,
  pendingFinish: 0,
  seq: 0,

  toggle: (mode = 'circle') => {
    const st = get();
    if (st.active && st.mode === mode) {
      // Same mode toggled off.
      set({ active: false, ...CLEARED });
    } else {
      // Only one cursor-owning tool at a time — stand the measure tool down.
      // Activating, or switching mode while active, starts from a clean slate.
      useMeasureStore.getState().exit();
      set({ active: true, mode, ...CLEARED });
    }
  },
  exit: () => set({ active: false, ...CLEARED }),
  begin: (center) => set({ center, hasCenter: true, radiusM: 0, error: null }),
  setRadius: (radiusM) => set({ radiusM }),
  addVertex: (p) => set((s) => ({ vertices: [...s.vertices, p], error: null })),
  undoVertex: () => set((s) => ({ vertices: s.vertices.slice(0, -1) })),
  setCursor: (cursor) => set({ cursor }),
  requestFinish: () => set((s) => ({ pendingFinish: s.pendingFinish + 1 })),
  reset: () => set({ ...CLEARED }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error, busy: false }),
  bumpSeq: () => set((s) => ({ seq: s.seq + 1 })),
}));

// Keep the two cursor-owning tools mutually exclusive. toggle() already stands
// the measure tool down when this one activates; this covers the reverse — if
// the measure tool turns on (e.g. from the top bar) while a zone is being drawn,
// stand this tool down. One-directional dependency (no circular import).
useMeasureStore.subscribe((s) => {
  if (s.active && useFuelZoneStore.getState().active) {
    useFuelZoneStore.getState().exit();
  }
});

// Pretty-print a radius / distance in meters.
export function formatRadius(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
  return `${Math.round(m)} m`;
}
