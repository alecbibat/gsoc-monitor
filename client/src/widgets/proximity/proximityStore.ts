import { create } from 'zustand';
import { scanProximity, type ScanResult } from './proximityScan';

// Shared state for the Property Watch widget and any popped-out property
// windows. A single throttled scanner backs all of them, so several open panels
// don't multiply the load on the FIRMS/NWS/USGS feeds — and a pop-out stays
// live on its own scan interval even after the main panel is closed.
const THROTTLE_MS = 60_000; // skip a fresh scan if one ran this recently

interface ProximityState {
  radiusMi: number;
  result: ScanResult | null;
  loading: boolean;
  lastScanAt: number;
  setRadius: (mi: number) => void;
  scan: (force?: boolean) => Promise<void>;
}

let inFlight: Promise<void> | null = null;

export const useProximityStore = create<ProximityState>((set, get) => ({
  radiusMi: 25,
  result: null,
  loading: false,
  lastScanAt: 0,
  setRadius: (radiusMi) => {
    if (radiusMi === get().radiusMi) return;
    set({ radiusMi });
    void get().scan(true);
  },
  scan: (force = false) => {
    const { lastScanAt, result } = get();
    if (!force && result && Date.now() - lastScanAt < THROTTLE_MS) return Promise.resolve();
    if (!force && inFlight) return inFlight;

    const radiusAtStart = get().radiusMi;
    set({ loading: true });
    const p = scanProximity(radiusAtStart)
      .then((r) => {
        // Discard if the radius changed while this scan was running.
        if (get().radiusMi === radiusAtStart) {
          set({ result: r, loading: false, lastScanAt: Date.now() });
        }
      })
      .catch(() => set({ loading: false }))
      .finally(() => {
        if (inFlight === p) inFlight = null;
      });
    inFlight = p;
    return p;
  },
}));
