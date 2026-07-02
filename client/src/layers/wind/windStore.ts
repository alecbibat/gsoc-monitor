import { create } from 'zustand';
import type { WindGrid } from '../../types';
import { api } from '../../api/client';
import { makeSampler, computeReading, type WindReading } from './windProbe';

// Status surfaced in the sidebar for the animated wind layer, plus the fetched
// grid itself so other features (the right-click probe, hover readout, and the
// direction-arrow overlay) can sample wind at any point without re-fetching.
interface WindState {
  ready: boolean;
  error: string | null;
  maxSpeedMps: number;
  grid: WindGrid | null;
  stale: boolean; // grid is historical (snapshot/fallback), not a live fetch
  arrowCount: number; // arrows currently drawn by the direction overlay
  setStatus: (partial: Partial<Omit<WindState, 'setStatus'>>) => void;
}

export const useWindStatus = create<WindState>((set) => ({
  ready: false,
  error: null,
  maxSpeedMps: 0,
  grid: null,
  stale: false,
  arrowCount: 0,
  setStatus: (partial) => set((s) => ({ ...s, ...partial })),
}));

// --- localStorage grid cache -------------------------------------------------
// The last fetched grid (~80 KB) so the field renders the instant a wind layer
// mounts — even on a fresh page load or with the server unreachable — and the
// network fetch swaps in fresh data seamlessly behind it.
const GRID_CACHE_KEY = 'gsoc-wind-grid';

function readCachedGrid(): WindGrid | null {
  try {
    const raw = localStorage.getItem(GRID_CACHE_KEY);
    if (!raw) return null;
    const grid = JSON.parse(raw) as WindGrid;
    return grid?.u?.length ? grid : null;
  } catch {
    return null;
  }
}

function writeCachedGrid(grid: WindGrid): void {
  try {
    localStorage.setItem(GRID_CACHE_KEY, JSON.stringify(grid));
  } catch {
    // Quota/private-mode — the server snapshot still covers reloads.
  }
}

// --- Shared grid loader --------------------------------------------------------
// Both wind layers (particles + direction arrows) need the same grid; a
// refcounted loader means one fetch loop no matter how many are active, and the
// store only resets once the last consumer releases.
const REFRESH_MS = 30 * 60_000;
let loaderRefs = 0;
let loaderTimer: ReturnType<typeof setInterval> | null = null;

async function loadGrid(): Promise<void> {
  try {
    const grid = await api.wind();
    useWindStatus.getState().setStatus({
      ready: true,
      error: null,
      maxSpeedMps: grid.speedMax,
      grid,
      stale: grid.stale ?? false,
    });
    writeCachedGrid(grid);
  } catch (err) {
    console.error('Failed to load wind grid', err);
    // Keep whatever grid we already have (cached or a previous fetch) rather
    // than blanking the field; hard-error only when there is nothing to show.
    if (useWindStatus.getState().grid) {
      useWindStatus.getState().setStatus({ stale: true, error: null });
    } else {
      useWindStatus.getState().setStatus({ error: 'Wind feed unavailable' });
    }
  }
}

export function acquireWindGrid(): () => void {
  loaderRefs++;
  if (loaderRefs === 1) {
    // Hydrate instantly from the cached grid (marked stale), then fetch.
    if (!useWindStatus.getState().grid) {
      const cached = readCachedGrid();
      if (cached) {
        useWindStatus.getState().setStatus({
          ready: true,
          error: null,
          maxSpeedMps: cached.speedMax,
          grid: cached,
          stale: true,
        });
      }
    }
    void loadGrid();
    loaderTimer = setInterval(() => void loadGrid(), REFRESH_MS);
  }
  let released = false;
  return () => {
    if (released) return; // a double-release must not steal another consumer's ref
    released = true;
    loaderRefs--;
    if (loaderRefs === 0) {
      if (loaderTimer) {
        clearInterval(loaderTimer);
        loaderTimer = null;
      }
      useWindStatus
        .getState()
        .setStatus({ ready: false, error: null, maxSpeedMps: 0, grid: null, arrowCount: 0 });
    }
  };
}

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
