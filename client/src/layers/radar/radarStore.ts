import { create } from 'zustand';
import type { RadarFrame } from '../../types';
import type { RadarPaletteId } from './palettes';

// Clouds/Combined are gone: RainViewer's infrared product is discontinued and
// the manifest now publishes zero `satellite.infrared` frames (Stage 0, Aug
// 2026), so both modes rendered nothing at all. Only precipitation remains.

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
  // Forecast frames appended after "now". RainViewer's own nowcast is
  // discontinued (Stage 0 confirmed the array is empty), so this stays empty
  // until Stage C fills it with our advection frames — the slot, the timeline
  // ordering and the hatched forecast styling all already work.
  nowcastFrames: RadarFrame[];
  windowMinutes: 30 | 60 | 120;
  // The playhead, as a FLOAT index into the timeline. 4.0 is exactly frame 4;
  // 4.5 is halfway between frames 4 and 5, which the warp renders as a storm
  // caught mid-travel rather than as a crossfade of two positions.
  //
  // A float index rather than minutes-relative-to-now because every consumer
  // wants a frame pair and a mix — `floor` and `fract` give both directly,
  // where a time would need a search through the timeline to find its pair.
  position: number;
  // The keyframe under the playhead, always `round(position)`. Kept because
  // warming, the Stage A tile path and engine v1 all want a single frame rather
  // than a pair, and because it is what the timeline's readout names.
  currentIndex: number;
  playing: boolean;
  // Playback rate multiplier. Scrubbing is unaffected — this only scales how
  // fast the playhead advances on its own.
  speed: 0.5 | 1 | 2;
  // True while the handle is being dragged. Motion rendering stands down for
  // the duration: a warp costs tens of milliseconds and the house rule is that
  // the frame under the handle is the frame on screen, immediately. Snapping to
  // the nearest cached keyframe is what makes a scrub instant.
  scrubbing: boolean;
  opacity: number;
  palette: RadarPaletteId;
  // How much of the playback loop is decoded and ready, 0–1 (engine v2 only).
  // Playback holds until the loop is warm so the first pass is smooth rather
  // than a download-per-frame stutter; the timeline shows it as a progress
  // ring on the play button and a buffered bar on the track.
  loopReady: number;
  // Stage B handover: how much of the imagery path to draw while the GPU
  // primitive covers the same field. 1 normally; the spike drives it toward 0
  // as the primitive fades in, so the two never double-expose the same echo.
  glTileDim: number;
  // The same idea for Stage C motion: while the warped region layer covers the
  // view, the tile path is dimmed out from under it so one echo is not drawn
  // twice. 1 whenever motion is standing down, which is the normal state.
  motionDim: number;
  // Whether the forecast zone can currently be drawn. The extrapolation needs a
  // decoded region and a measurable flow over the newest observed pair, and
  // neither is guaranteed; the timeline says so rather than leaving the user to
  // wonder why the hatched stretch is empty.
  forecastAvailable: boolean;
  setManifest: (host: string, frames: RadarFrame[], nowcastFrames: RadarFrame[]) => void;
  setWindowMinutes: (m: 30 | 60 | 120) => void;
  setCurrentIndex: (i: number) => void;
  /** Move the playhead continuously; `currentIndex` follows as the round. */
  setPosition: (p: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: 0.5 | 1 | 2) => void;
  setScrubbing: (b: boolean) => void;
  setOpacity: (o: number) => void;
  setPalette: (p: RadarPaletteId) => void;
  setLoopReady: (r: number) => void;
  setGlTileDim: (d: number) => void;
  setMotionDim: (d: number) => void;
  setForecastAvailable: (a: boolean) => void;
}

// RainViewer republishes an identical manifest on most polls; comparing
// signatures lets setManifest skip the write so the imagery-layer stack isn't
// torn down and re-downloaded for no visual change.
function manifestSig(host: string, frames: RadarFrame[], nowcastFrames: RadarFrame[]): string {
  return (
    `${host}|${frames.map((f) => f.path).join(',')}` +
    `|${nowcastFrames.map((f) => f.path).join(',')}`
  );
}

export const useRadarStore = create<RadarState>((set) => ({
  host: '',
  frames: [],
  nowcastFrames: [],
  // Default to the full ~2h window so the scrubber spans a satisfying range
  // (plus the forecast frames appended after "now").
  windowMinutes: 120,
  position: 0,
  currentIndex: 0,
  playing: true,
  speed: 1,
  scrubbing: false,
  // Full layer opacity by default: translucency now lives in the palette
  // per-pixel (light rain airy, cores solid), not in a flat layer fade.
  opacity: 1,
  palette: 'storm',
  loopReady: 0,
  glTileDim: 1,
  motionDim: 1,
  forecastAvailable: false,
  setManifest: (host, frames, nowcastFrames) =>
    set((s) =>
      manifestSig(host, frames, nowcastFrames) === manifestSig(s.host, s.frames, s.nowcastFrames)
        ? {}
        : { host, frames, nowcastFrames }
    ),
  setWindowMinutes: (m) => set({ windowMinutes: m }),
  // Both setters write both fields, so the two can never disagree about where
  // the playhead is. Landing on a keyframe means landing on it exactly — a
  // scrub that stops at frame 4 renders frame 4, not a 0.997 warp of it.
  setCurrentIndex: (i) => set({ currentIndex: i, position: i }),
  setPosition: (p) =>
    set((s) => {
      const currentIndex = Math.round(p);
      if (s.position === p && s.currentIndex === currentIndex) return {};
      return { position: p, currentIndex };
    }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setScrubbing: (scrubbing) => set((s) => (s.scrubbing === scrubbing ? {} : { scrubbing })),
  setOpacity: (opacity) => set({ opacity }),
  setPalette: (palette) => set({ palette }),
  setLoopReady: (loopReady) => set((s) => (s.loopReady === loopReady ? {} : { loopReady })),
  setGlTileDim: (glTileDim) => set((s) => (s.glTileDim === glTileDim ? {} : { glTileDim })),
  setMotionDim: (motionDim) => set((s) => (s.motionDim === motionDim ? {} : { motionDim })),
  setForecastAvailable: (forecastAvailable) =>
    set((s) => (s.forecastAvailable === forecastAvailable ? {} : { forecastAvailable })),
}));

// Playback waits for the loop to be nearly warm rather than fully warm: the
// last few tiles are usually an off-screen straggler, and holding the whole
// timeline hostage to them reads as the radar being broken.
export const LOOP_READY_THRESHOLD = 0.9;

export function framesInWindow(frames: RadarFrame[], windowMinutes: number): RadarFrame[] {
  const count = Math.max(1, Math.round(windowMinutes / 10));
  return frames.slice(Math.max(0, frames.length - count));
}

// The full ordered playback timeline: observed frames (within the window)
// followed by any forecast frames.
//
// Takes a shape rather than the store so callers outside this module can pass
// the whole state — EarthTimeBar does exactly that, and structural typing keeps
// it working as fields come and go here.
export function buildTimeline(s: {
  frames: RadarFrame[];
  nowcastFrames: RadarFrame[];
  windowMinutes: number;
}): TimelineFrame[] {
  const past = framesInWindow(s.frames, s.windowMinutes).map((f) => ({
    frame: f,
    time: f.time,
    forecast: false,
  }));
  const fcst = s.nowcastFrames.map((f) => ({ frame: f, time: f.time, forecast: true }));
  return [...past, ...fcst];
}

// The frame pair a float playhead sits between, and how far between them.
//
// `t` is clamped to a real interval at both ends: past the last frame there is
// nothing to warp toward, so the playhead pins to it rather than extrapolating.
// Extrapolation past the newest observed frame is a forecast, which is PR 8's
// job and has to be labelled as one — silently warping past the end here would
// present invented weather as observed.
export interface FramePair {
  a: TimelineFrame;
  b: TimelineFrame;
  /** 0 = exactly `a`, 1 = exactly `b`. */
  t: number;
  /** Index of `a`, so callers can name the pair without recomputing. */
  index: number;
}

export function framePairAt(timeline: TimelineFrame[], position: number): FramePair | null {
  if (timeline.length === 0) return null;
  if (timeline.length === 1) {
    return { a: timeline[0], b: timeline[0], t: 0, index: 0 };
  }
  const clamped = Math.min(Math.max(0, position), timeline.length - 1);
  const index = Math.min(Math.floor(clamped), timeline.length - 2);
  return { a: timeline[index], b: timeline[index + 1], t: clamped - index, index };
}

// Index of the "now" frame (the last observed frame) within a timeline.
export function nowIndex(timeline: TimelineFrame[]): number {
  const firstForecast = timeline.findIndex((t) => t.forecast);
  if (firstForecast === -1) return Math.max(0, timeline.length - 1);
  return Math.max(0, firstForecast - 1);
}
