import { create } from 'zustand';
import type { WindGrid } from '../../types';
import { makeSampler, computeReading, type WindReading } from './windProbe';

// Status surfaced in the sidebar for the animated wind layer, plus the fetched
// grid itself so other features (the right-click probe and hover readout) can
// sample wind at any point without re-fetching.
interface WindState {
  ready: boolean;
  error: string | null;
  maxSpeedMps: number;
  grid: WindGrid | null;
  setStatus: (partial: Partial<Omit<WindState, 'setStatus'>>) => void;
}

export const useWindStatus = create<WindState>((set) => ({
  ready: false,
  error: null,
  maxSpeedMps: 0,
  grid: null,
  setStatus: (partial) => set((s) => ({ ...s, ...partial })),
}));

// Lazily build (and cache) a sampler for the current grid so repeated probes —
// e.g. one per mouse-move while hovering — don't re-allocate the closure.
let cachedGrid: WindGrid | null = null;
let cachedSampler: ReturnType<typeof makeSampler> | null = null;
const probeOut: [number, number] = [0, 0];

// Read the live wind at a point. Returns null if the grid hasn't loaded yet or
// the point is outside the covered latitude band.
export function probeWindAt(lon: number, lat: number): WindReading | null {
  const grid = useWindStatus.getState().grid;
  if (!grid) return null;
  if (grid !== cachedGrid) {
    cachedGrid = grid;
    cachedSampler = makeSampler(grid);
  }
  if (!cachedSampler || !cachedSampler(lon, lat, probeOut)) return null;
  return computeReading(lon, lat, probeOut[0], probeOut[1]);
}
