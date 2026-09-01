import { create } from 'zustand';
import type { RadarFrame, RadarManifest } from '../../types';
import type { RadarStyle } from './palettes';
import type { RadarCoverage } from './sources';

// One slot on the playback timeline. Slots are the union of both sources'
// frame times inside the window; each carries whichever source frames are
// near enough in time to show for it (5-min HD frames fill between 10-min
// global frames in auto mode, and vice versa outside HD coverage).
export interface TimelineSlot {
  time: number; // epoch seconds
  us: number | null; // HD frame time to display, or null
  global: RadarFrame | null; // global frame to display, or null
}

interface RadarState {
  // Data (from /api/radar)
  globalHost: string;
  globalFrames: RadarFrame[]; // past only — the free tier has no nowcast
  usFrames: number[]; // epoch seconds, minute % 5, oldest → newest
  globalAvailable: boolean; // false when RainViewer is down/unreachable
  // Settings
  coverage: RadarCoverage;
  style: RadarStyle;
  windowMinutes: 60 | 120;
  opacity: number;
  // Playback
  currentIndex: number;
  playing: boolean;
  setManifest: (m: RadarManifest) => void;
  setCoverage: (c: RadarCoverage) => void;
  setStyle: (s: RadarStyle) => void;
  setWindowMinutes: (m: 60 | 120) => void;
  setOpacity: (o: number) => void;
  setCurrentIndex: (i: number) => void;
  setPlaying: (p: boolean) => void;
}

// Merge tolerance when a HD and a global frame land on (nearly) the same
// timestamp — they become one slot, keyed to the HD time.
const SLOT_MERGE_SEC = 150;
// How far a source frame may sit from a slot's time and still be shown for
// it: half a cadence step plus slack, per source.
const US_SHOW_TOLERANCE = 180;
const GLOBAL_SHOW_TOLERANCE = 360;

function nearestUs(frames: number[], time: number): number | null {
  let best: number | null = null;
  let bestD = US_SHOW_TOLERANCE + 1;
  for (const t of frames) {
    const d = Math.abs(t - time);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

function nearestGlobal(frames: RadarFrame[], time: number): RadarFrame | null {
  let best: RadarFrame | null = null;
  let bestD = GLOBAL_SHOW_TOLERANCE + 1;
  for (const f of frames) {
    const d = Math.abs(f.time - time);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

// The ordered playback timeline for the current coverage + window. Takes the
// whole store state (EarthTimeBar calls it that way to decide its offset).
export function buildTimeline(s: {
  coverage: RadarCoverage;
  windowMinutes: number;
  usFrames: number[];
  globalFrames: RadarFrame[];
}): TimelineSlot[] {
  const useUs = s.coverage !== 'global';
  const useGlobal = s.coverage !== 'us';
  const usTimes = useUs ? s.usFrames : [];
  const globalTimes = useGlobal ? s.globalFrames.map((f) => f.time) : [];
  if (usTimes.length === 0 && globalTimes.length === 0) return [];

  const latest = Math.max(usTimes[usTimes.length - 1] ?? 0, globalTimes[globalTimes.length - 1] ?? 0);
  const windowStart = latest - s.windowMinutes * 60;

  // Union of times inside the window, HD times absorbing near-duplicates.
  const times: number[] = usTimes.filter((t) => t >= windowStart);
  for (const t of globalTimes) {
    if (t < windowStart) continue;
    if (!times.some((u) => Math.abs(u - t) <= SLOT_MERGE_SEC)) times.push(t);
  }
  times.sort((a, b) => a - b);

  return times.map((time) => ({
    time,
    us: useUs ? nearestUs(usTimes, time) : null,
    global: useGlobal ? nearestGlobal(s.globalFrames, time) : null,
  }));
}

// Manifests mostly repeat between polls; comparing signatures lets
// setManifest skip the write so nothing downstream rebuilds for no change.
function manifestSig(host: string, globalFrames: RadarFrame[], usFrames: number[]): string {
  return `${host}|${globalFrames.map((f) => f.path).join(',')}|${usFrames.join(',')}`;
}

export const useRadarStore = create<RadarState>((set) => ({
  globalHost: '',
  globalFrames: [],
  usFrames: [],
  globalAvailable: true,
  coverage: 'auto',
  style: 'storm',
  windowMinutes: 60,
  opacity: 1,
  currentIndex: 0,
  playing: true,
  setManifest: (m) =>
    set((s) => {
      const host = m.global?.host ?? '';
      const globalFrames = m.global?.frames ?? [];
      const usFrames = m.us?.frames ?? [];
      if (
        manifestSig(host, globalFrames, usFrames) ===
        manifestSig(s.globalHost, s.globalFrames, s.usFrames)
      ) {
        return { globalAvailable: m.global != null };
      }
      // Live pinning: a view sitting on the newest frame follows new frames
      // as they arrive instead of drifting into the past.
      const oldLen = buildTimeline(s).length;
      const next = { ...s, globalHost: host, globalFrames, usFrames };
      const newLen = buildTimeline(next).length;
      const wasLive = oldLen === 0 || s.currentIndex >= oldLen - 1;
      return {
        globalHost: host,
        globalFrames,
        usFrames,
        globalAvailable: m.global != null,
        currentIndex: wasLive ? Math.max(0, newLen - 1) : Math.min(s.currentIndex, newLen - 1),
      };
    }),
  setCoverage: (coverage) =>
    set((s) => ({
      coverage,
      // Land on "now" in the new coverage's timeline.
      currentIndex: Math.max(0, buildTimeline({ ...s, coverage }).length - 1),
    })),
  setStyle: (style) => set({ style }),
  setWindowMinutes: (windowMinutes) => set({ windowMinutes }),
  setOpacity: (opacity) => set({ opacity }),
  setCurrentIndex: (currentIndex) => set({ currentIndex }),
  setPlaying: (playing) => set({ playing }),
}));
