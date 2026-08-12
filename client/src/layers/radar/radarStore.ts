import { create } from 'zustand';
import type { RadarFrame } from '../../types';
import type { RadarPaletteId } from './palettes';

export type RadarMode = 'radar' | 'satellite' | 'combined';

// One slot on the playback timeline: a frame, its time (epoch seconds), and
// whether it's a forecast (nowcast) frame rather than an observed one.
export interface TimelineFrame {
  frame: RadarFrame;
  time: number;
  forecast: boolean;
}

interface RadarState {
  host: string;
  frames: RadarFrame[]; // observed (past) radar
  nowcastFrames: RadarFrame[]; // RainViewer forecast/nowcast radar
  satelliteFrames: RadarFrame[];
  mode: RadarMode;
  windowMinutes: 30 | 60 | 120;
  currentIndex: number;
  playing: boolean;
  opacity: number;
  palette: RadarPaletteId;
  // How much of the playback loop is decoded and ready, 0–1 (engine v2 only).
  // Playback holds until the loop is warm so the first pass is smooth rather
  // than a download-per-frame stutter; the timeline shows it as a progress
  // ring on the play button and a buffered bar on the track.
  loopReady: number;
  setManifest: (
    host: string,
    frames: RadarFrame[],
    nowcastFrames: RadarFrame[],
    satelliteFrames: RadarFrame[]
  ) => void;
  setMode: (m: RadarMode) => void;
  setWindowMinutes: (m: 30 | 60 | 120) => void;
  setCurrentIndex: (i: number) => void;
  setPlaying: (p: boolean) => void;
  setOpacity: (o: number) => void;
  setPalette: (p: RadarPaletteId) => void;
  setLoopReady: (r: number) => void;
}

// RainViewer republishes an identical manifest on most polls; comparing
// signatures lets setManifest skip the write so the imagery-layer stack isn't
// torn down and re-downloaded for no visual change.
function manifestSig(
  host: string,
  frames: RadarFrame[],
  nowcastFrames: RadarFrame[],
  satelliteFrames: RadarFrame[]
): string {
  return (
    `${host}|${frames.map((f) => f.path).join(',')}` +
    `|${nowcastFrames.map((f) => f.path).join(',')}` +
    `|${satelliteFrames.map((f) => f.path).join(',')}`
  );
}

export const useRadarStore = create<RadarState>((set) => ({
  host: '',
  frames: [],
  nowcastFrames: [],
  satelliteFrames: [],
  // Default to plain radar until the keyed-cloud rendering is calibrated
  // against real RainViewer IR tiles (see CLIENT_RECOLOR in
  // RainViewerImagery.ts); then 'combined' — radar over keyed clouds, the
  // zoom.earth composition — becomes the default again.
  mode: 'radar',
  // Default to the full ~2h window so the scrubber spans a satisfying range
  // (plus the forecast frames appended after "now").
  windowMinutes: 120,
  currentIndex: 0,
  playing: true,
  // Full layer opacity by default: translucency now lives in the palette
  // per-pixel (light rain airy, cores solid), not in a flat layer fade.
  opacity: 1,
  palette: 'storm',
  loopReady: 0,
  setManifest: (host, frames, nowcastFrames, satelliteFrames) =>
    set((s) =>
      manifestSig(host, frames, nowcastFrames, satelliteFrames) ===
      manifestSig(s.host, s.frames, s.nowcastFrames, s.satelliteFrames)
        ? {}
        : { host, frames, nowcastFrames, satelliteFrames }
    ),
  setMode: (mode) => set({ mode, currentIndex: 0 }),
  setWindowMinutes: (m) => set({ windowMinutes: m }),
  setCurrentIndex: (i) => set({ currentIndex: i }),
  setPlaying: (playing) => set({ playing }),
  setOpacity: (opacity) => set({ opacity }),
  setPalette: (palette) => set({ palette }),
  setLoopReady: (loopReady) => set((s) => (s.loopReady === loopReady ? {} : { loopReady })),
}));

// Playback waits for the loop to be nearly warm rather than fully warm: the
// last few tiles are usually an off-screen straggler, and holding the whole
// timeline hostage to them reads as the radar being broken.
export const LOOP_READY_THRESHOLD = 0.9;

export function framesInWindow(frames: RadarFrame[], windowMinutes: number): RadarFrame[] {
  const count = Math.max(1, Math.round(windowMinutes / 10));
  return frames.slice(Math.max(0, frames.length - count));
}

// The full ordered playback timeline for the current mode: observed frames
// (within the window) followed by the forecast frames. Satellite mode has no
// forecast product, so it's just the windowed satellite frames.
export function buildTimeline(s: {
  mode: RadarMode;
  frames: RadarFrame[];
  nowcastFrames: RadarFrame[];
  satelliteFrames: RadarFrame[];
  windowMinutes: number;
}): TimelineFrame[] {
  if (s.mode === 'satellite') {
    return framesInWindow(s.satelliteFrames, s.windowMinutes).map((f) => ({
      frame: f,
      time: f.time,
      forecast: false,
    }));
  }
  const past = framesInWindow(s.frames, s.windowMinutes).map((f) => ({
    frame: f,
    time: f.time,
    forecast: false,
  }));
  const fcst = s.nowcastFrames.map((f) => ({ frame: f, time: f.time, forecast: true }));
  return [...past, ...fcst];
}

// Index of the "now" frame (the last observed frame) within a timeline.
export function nowIndex(timeline: TimelineFrame[]): number {
  const firstForecast = timeline.findIndex((t) => t.forecast);
  if (firstForecast === -1) return Math.max(0, timeline.length - 1);
  return Math.max(0, firstForecast - 1);
}
