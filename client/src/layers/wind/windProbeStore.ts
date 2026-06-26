import { create } from 'zustand';
import type { WindReading } from './windProbe';

// State shared between the WindProbeController (Cesium side: handlers + on-globe
// arrows) and the WindReadout overlay (React HUD). `hover` is the live reading
// under the cursor; `pins` are readings the user right-clicked to keep.

export interface WindPin extends WindReading {
  id: number;
}

interface WindProbeState {
  hover: WindReading | null;
  pins: WindPin[];
  setHover: (r: WindReading | null) => void;
  addPin: (r: WindReading) => void;
  removePin: (id: number) => void;
  clearPins: () => void;
}

let nextPinId = 1;

export const useWindProbeStore = create<WindProbeState>((set) => ({
  hover: null,
  pins: [],
  // Avoid churning React when the cursor leaves the globe repeatedly.
  setHover: (r) => set((s) => (r === null && s.hover === null ? s : { hover: r })),
  addPin: (r) => set((s) => ({ pins: [...s.pins, { ...r, id: nextPinId++ }] })),
  removePin: (id) => set((s) => ({ pins: s.pins.filter((p) => p.id !== id) })),
  clearPins: () => set({ pins: [] }),
}));
