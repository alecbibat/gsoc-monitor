import { create } from 'zustand';
import type { RadarFrame } from '../../types';

interface RadarState {
  host: string;
  frames: RadarFrame[];
  windowMinutes: 30 | 60 | 120;
  currentIndex: number;
  playing: boolean;
  opacity: number;
  setManifest: (host: string, frames: RadarFrame[]) => void;
  setWindowMinutes: (m: 30 | 60 | 120) => void;
  setCurrentIndex: (i: number) => void;
  setPlaying: (p: boolean) => void;
  setOpacity: (o: number) => void;
}

export const useRadarStore = create<RadarState>((set) => ({
  host: '',
  frames: [],
  windowMinutes: 30,
  currentIndex: 0,
  playing: true,
  opacity: 0.7,
  setManifest: (host, frames) => set({ host, frames }),
  setWindowMinutes: (m) => set({ windowMinutes: m }),
  setCurrentIndex: (i) => set({ currentIndex: i }),
  setPlaying: (playing) => set({ playing }),
  setOpacity: (opacity) => set({ opacity }),
}));

export function framesInWindow(frames: RadarFrame[], windowMinutes: number): RadarFrame[] {
  // RainViewer ships past frames at 10-minute steps.
  const count = Math.max(1, Math.round(windowMinutes / 10));
  return frames.slice(Math.max(0, frames.length - count));
}
