import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RadarFrame, RadarManifest } from '../../types';
import { isRadarPalette, type RadarPaletteId } from './radarPalettes';
import { formatClock, manifestSignature, RADAR_WINDOWS, type RadarWindow } from './radarTimeline';

export const RADAR_SPEEDS = [0.5, 1, 2] as const;
export type RadarSpeed = (typeof RADAR_SPEEDS)[number];

export const DEFAULT_RADAR_PREFS = {
  windowMinutes: 120 as RadarWindow,
  opacity: 0.9,
  palette: 'classic' as RadarPaletteId,
  speed: 1 as RadarSpeed,
  snow: true, // paint snow in its own (white) ramp
};

// A frame is "stale" when the newest one is this old: RainViewer publishes
// every 10 minutes, so this means a feed outage, not normal lag.
export const STALE_AFTER_SEC = 30 * 60;

interface RadarState {
  // Manifest (runtime)
  host: string;
  past: RadarFrame[];
  nowcast: RadarFrame[];
  generated: number | null; // manifest timestamp (epoch seconds)
  loading: boolean; // no manifest received yet
  error: string | null; // last fetch failure; frames already loaded stay usable
  // Tile pipeline (runtime)
  coolingDownMs: number; // RainViewer rate-limited us; loading resumes after this
  // Preferences (persisted)
  windowMinutes: RadarWindow;
  opacity: number;
  palette: RadarPaletteId;
  speed: RadarSpeed;
  snow: boolean;
  setManifest: (m: RadarManifest) => void;
  setError: (message: string) => void;
  setCoolingDown: (ms: number) => void;
  setWindowMinutes: (w: RadarWindow) => void;
  setOpacity: (opacity: number) => void;
  setPalette: (palette: RadarPaletteId) => void;
  setSpeed: (speed: RadarSpeed) => void;
  setSnow: (snow: boolean) => void;
}

function clampOpacity(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(1, Math.max(0.2, v))
    : DEFAULT_RADAR_PREFS.opacity;
}

export const useRadarStore = create<RadarState>()(
  persist(
    (set) => ({
      host: '',
      past: [],
      nowcast: [],
      generated: null,
      loading: true,
      error: null,
      coolingDownMs: 0,
      ...DEFAULT_RADAR_PREFS,
      setManifest: (m) =>
        set((s) =>
          manifestSignature(m.host, m.past, m.nowcast) === manifestSignature(s.host, s.past, s.nowcast)
            ? { generated: m.generated, loading: false, error: null }
            : {
                host: m.host,
                past: m.past,
                nowcast: m.nowcast,
                generated: m.generated,
                loading: false,
                error: null,
              }
        ),
      setError: (error) => set({ error, loading: false }),
      setCoolingDown: (coolingDownMs) => set({ coolingDownMs }),
      setWindowMinutes: (windowMinutes) => set({ windowMinutes }),
      setOpacity: (opacity) => set({ opacity: clampOpacity(opacity) }),
      setPalette: (palette) => set({ palette }),
      setSpeed: (speed) => set({ speed }),
      setSnow: (snow) => set({ snow }),
    }),
    {
      name: 'gsoc-radar',
      version: 1,
      partialize: (s) => ({
        windowMinutes: s.windowMinutes,
        opacity: s.opacity,
        palette: s.palette,
        speed: s.speed,
        snow: s.snow,
      }),
      // Validate everything read back: a value from an older build (or a hand
      // edit) must never wedge the controls.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Record<keyof typeof DEFAULT_RADAR_PREFS, unknown>>;
        return {
          ...current,
          windowMinutes: RADAR_WINDOWS.includes(p.windowMinutes as RadarWindow)
            ? (p.windowMinutes as RadarWindow)
            : DEFAULT_RADAR_PREFS.windowMinutes,
          opacity: clampOpacity(p.opacity),
          palette: isRadarPalette(p.palette) ? p.palette : DEFAULT_RADAR_PREFS.palette,
          speed: RADAR_SPEEDS.includes(p.speed as RadarSpeed) ? (p.speed as RadarSpeed) : DEFAULT_RADAR_PREFS.speed,
          snow: typeof p.snow === 'boolean' ? p.snow : DEFAULT_RADAR_PREFS.snow,
        };
      },
    }
  )
);

// One-line status for the sidebar toggle.
export function radarStatusText(
  s: Pick<RadarState, 'loading' | 'error' | 'past' | 'nowcast' | 'coolingDownMs'>,
  nowSec: number = Date.now() / 1000
): string {
  const latest = s.past[s.past.length - 1];
  if (!latest) return s.error ? 'Radar feed unavailable · retrying' : 'Loading RainViewer frames…';
  const frames = `${s.past.length} frames · latest ${formatClock(latest.time)}`;
  if (s.error) return `Radar feed stale · ${frames}`;
  if (nowSec - latest.time > STALE_AFTER_SEC) return `Radar feed delayed · ${frames}`;
  if (s.coolingDownMs > 0) {
    return `RainViewer rate limit · resuming in ${Math.ceil(s.coolingDownMs / 1000)} s`;
  }
  const forecast = s.nowcast.length > 0 ? ` · ${s.nowcast.length} forecast` : '';
  return `RainViewer composite · ${frames}${forecast}`;
}
