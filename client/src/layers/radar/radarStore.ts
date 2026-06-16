import { create } from 'zustand';
import type { RadarFrame } from '../../types';

export type RadarMode = 'radar' | 'satellite' | 'combined';

interface RadarState {
  host: string;
  frames: RadarFrame[];
  satelliteFrames: RadarFrame[];
  mode: RadarMode;
  windowMinutes: 30 | 60 | 120;
  currentIndex: number;
  playing: boolean;
  opacity: number;
  colorScheme: number;
  setManifest: (host: string, frames: RadarFrame[], satelliteFrames: RadarFrame[]) => void;
  setMode: (m: RadarMode) => void;
  setWindowMinutes: (m: 30 | 60 | 120) => void;
  setCurrentIndex: (i: number) => void;
  setPlaying: (p: boolean) => void;
  setOpacity: (o: number) => void;
  setColorScheme: (c: number) => void;
}

export const useRadarStore = create<RadarState>((set) => ({
  host: '',
  frames: [],
  satelliteFrames: [],
  // 'radar' shows just the precipitation, no busy infrared cloud base.
  mode: 'radar',
  windowMinutes: 30,
  currentIndex: 0,
  playing: true,
  opacity: 0.75,
  // RainViewer color scheme 4 = "The Weather Channel": the clean green → yellow
  // → orange → red → magenta gradient zoom.earth uses.
  colorScheme: 4,
  setManifest: (host, frames, satelliteFrames) => set({ host, frames, satelliteFrames }),
  setMode: (mode) => set({ mode, currentIndex: 0 }),
  setWindowMinutes: (m) => set({ windowMinutes: m }),
  setCurrentIndex: (i) => set({ currentIndex: i }),
  setPlaying: (playing) => set({ playing }),
  setOpacity: (opacity) => set({ opacity }),
  setColorScheme: (colorScheme) => set({ colorScheme }),
}));

export function framesInWindow(frames: RadarFrame[], windowMinutes: number): RadarFrame[] {
  const count = Math.max(1, Math.round(windowMinutes / 10));
  return frames.slice(Math.max(0, frames.length - count));
}
