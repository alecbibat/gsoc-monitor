import { create } from 'zustand';

// "Hover" mode: a cinematic orbit (like the pins screensaver) around a single
// custom point the user picks by clicking the globe.
interface HoverState {
  active: boolean; // orbit is running
  picking: boolean; // waiting for the user to click an orbit center
  point: { lat: number; lon: number } | null;
  startPicking: () => void;
  setPoint: (lat: number, lon: number) => void;
  stop: () => void;
}

export const useHoverStore = create<HoverState>((set) => ({
  active: false,
  picking: false,
  point: null,
  startPicking: () => set({ picking: true, active: false, point: null }),
  setPoint: (lat, lon) => set({ point: { lat, lon }, picking: false, active: true }),
  stop: () => set({ active: false, picking: false, point: null }),
}));
