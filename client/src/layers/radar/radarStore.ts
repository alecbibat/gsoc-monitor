import { create } from 'zustand';
import type { RadarFrame, RadarManifest } from '../../types';
import { formatClock, manifestSignature, type RadarWindow } from './radarTimeline';

interface RadarState {
  host: string;
  past: RadarFrame[];
  nowcast: RadarFrame[];
  generated: number | null; // manifest timestamp (epoch seconds)
  loading: boolean; // no manifest received yet
  error: string | null; // last fetch failure; frames already loaded stay usable
  windowMinutes: RadarWindow;
  currentIndex: number;
  playing: boolean;
  opacity: number;
  setManifest: (m: RadarManifest) => void;
  setError: (message: string) => void;
  setWindowMinutes: (w: RadarWindow) => void;
  setCurrentIndex: (i: number) => void;
  setPlaying: (playing: boolean) => void;
  setOpacity: (opacity: number) => void;
}

export const useRadarStore = create<RadarState>((set) => ({
  host: '',
  past: [],
  nowcast: [],
  generated: null,
  loading: true,
  error: null,
  windowMinutes: 120,
  currentIndex: 0,
  playing: true,
  // The served tiles are solid colors, so leave a little basemap showing through.
  opacity: 0.8,
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
  setWindowMinutes: (windowMinutes) => set({ windowMinutes }),
  setCurrentIndex: (currentIndex) => set({ currentIndex }),
  setPlaying: (playing) => set({ playing }),
  setOpacity: (opacity) => set({ opacity }),
}));

// One-line status for the sidebar toggle.
export function radarStatusText(
  s: Pick<RadarState, 'loading' | 'error' | 'past' | 'nowcast'>
): string {
  const latest = s.past[s.past.length - 1];
  if (!latest) return s.error ? 'Radar feed unavailable · retrying' : 'Loading RainViewer frames…';
  const frames = `${s.past.length} frames · latest ${formatClock(latest.time)}`;
  if (s.error) return `Radar feed stale · ${frames}`;
  const forecast = s.nowcast.length > 0 ? ` · ${s.nowcast.length} forecast` : '';
  return `RainViewer composite · ${frames}${forecast}`;
}
