import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LightningStatusLite } from '../../types/lightning';

// How far back the globe shows strikes. The server always sends the full 24 h
// field; the window only hides older marks client-side, so switching is
// instant. Defaults to 24 h and is remembered.
export type LightningWindow = 60 | 360 | 720 | 1440;
export const LIGHTNING_WINDOWS: { value: LightningWindow; label: string }[] = [
  { value: 60, label: '1h' },
  { value: 360, label: '6h' },
  { value: 720, label: '12h' },
  { value: 1440, label: '24h' },
];
export const DEFAULT_LIGHTNING_WINDOW: LightningWindow = 1440;
const isWindow = (v: unknown): v is LightningWindow => LIGHTNING_WINDOWS.some((w) => w.value === v);

/** Where live strikes are coming from right now. */
export type LiveSource = 'browser' | 'server' | 'offline';

// Readout of the display field (filled by LightningLayer).
export interface LightningFieldStatus {
  /** Sampled 24 h marks currently held. */
  marks: number;
  /** Individual live strikes currently drawn. */
  liveShown: number;
  loading: boolean;
  error: string | null;
  lastOkAt: number | null;
  degraded: null | 'busy' | 'stale';
}

const EMPTY_FIELD: LightningFieldStatus = {
  marks: 0,
  liveShown: 0,
  loading: false,
  error: null,
  lastOkAt: null,
  degraded: null,
};

interface LightningStatusState {
  // Persisted
  windowMinutes: LightningWindow;
  // Browser socket (live bolts) — LightningTicker and the sidebar read these.
  connected: boolean;
  /** Strikes/min seen by the browser socket (global). */
  ratePerMin: number;
  error: string | null;
  liveSource: LiveSource;
  // Server collector health, from each /field response.
  server: LightningStatusLite | null;
  field: LightningFieldStatus;
  setStatus: (
    partial: Partial<Pick<LightningStatusState, 'connected' | 'ratePerMin' | 'error' | 'liveSource'>>
  ) => void;
  setWindow: (m: LightningWindow) => void;
  setServer: (s: LightningStatusLite | null) => void;
  setField: (partial: Partial<LightningFieldStatus>) => void;
  /** Clear everything except the persisted window (layer off / unmount). */
  resetRuntime: () => void;
}

export const useLightningStatus = create<LightningStatusState>()(
  persist(
    (set) => ({
      windowMinutes: DEFAULT_LIGHTNING_WINDOW,
      connected: false,
      ratePerMin: 0,
      error: null,
      liveSource: 'offline',
      server: null,
      field: EMPTY_FIELD,
      setStatus: (partial) => set(partial),
      setWindow: (windowMinutes) => set({ windowMinutes }),
      setServer: (server) => set({ server }),
      setField: (partial) => set((prev) => ({ field: { ...prev.field, ...partial } })),
      resetRuntime: () =>
        set({
          connected: false,
          ratePerMin: 0,
          error: null,
          liveSource: 'offline',
          server: null,
          field: EMPTY_FIELD,
        }),
    }),
    {
      name: 'gsoc-lightning',
      version: 1,
      partialize: (s) => ({ windowMinutes: s.windowMinutes }),
      merge: (persisted, current) => {
        const w = (persisted as { windowMinutes?: unknown } | undefined)?.windowMinutes;
        return { ...current, windowMinutes: isWindow(w) ? w : DEFAULT_LIGHTNING_WINDOW };
      },
    }
  )
);
