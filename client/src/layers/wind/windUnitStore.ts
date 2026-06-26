import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WindUnit } from './windProbe';

// Global, persisted wind-speed unit preference. Set from the forecast panel's
// toggle; read by the forecast panel, the on-globe pin labels, and the HUD so
// every wind readout shows the same unit.
interface WindUnitState {
  unit: WindUnit;
  setUnit: (u: WindUnit) => void;
}

export const useWindUnit = create<WindUnitState>()(
  persist((set) => ({ unit: 'mph', setUnit: (unit) => set({ unit }) }), {
    name: 'gsoc-wind-unit',
  })
);
