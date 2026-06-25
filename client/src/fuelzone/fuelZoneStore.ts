import { create } from 'zustand';
import { useMeasureStore } from '../measure/measureStore';
import type { LngLat } from './zonalStats';

// Draw-a-circle "fuel zone analysis" tool. Mirrors the measure tool: a single
// cursor-owning interaction with its own state machine.
//   idle    → tool active, waiting for the first click (circle center)
//   sizing  → center set, dragging to set the radius; second click finalizes
//   busy    → finalized, querying LANDFIRE for the histogram
interface FuelZoneState {
  active: boolean;
  center: LngLat | null;
  radiusM: number;
  hasCenter: boolean;
  busy: boolean;
  error: string | null;
  seq: number; // increments per completed analysis → unique panel ids

  toggle: () => void;
  exit: () => void;
  begin: (center: LngLat) => void;
  setRadius: (m: number) => void;
  reset: () => void; // clear center/radius but stay in draw mode
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  bumpSeq: () => void;
}

const CLEARED = {
  center: null,
  radiusM: 0,
  hasCenter: false,
  busy: false,
  error: null,
} as const;

export const useFuelZoneStore = create<FuelZoneState>((set, get) => ({
  active: false,
  ...CLEARED,
  seq: 0,

  toggle: () => {
    if (get().active) {
      set({ active: false, ...CLEARED });
    } else {
      // Only one cursor-owning tool at a time — stand the measure tool down.
      useMeasureStore.getState().exit();
      set({ active: true, ...CLEARED });
    }
  },
  exit: () => set({ active: false, ...CLEARED }),
  begin: (center) => set({ center, hasCenter: true, radiusM: 0, error: null }),
  setRadius: (radiusM) => set({ radiusM }),
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
