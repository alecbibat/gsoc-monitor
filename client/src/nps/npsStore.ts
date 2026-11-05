import { useEffect } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { startVisiblePolling } from '../lib/poll';
import type { NpsFeed } from '../types';

// ── NPS feed: one poller, many readers ───────────────────────────────────────
// The ticker, the National Parks panel and the alert notifier all read the
// same /api/nps/feed. Components that show it call useNpsFeed(); the first one
// mounted starts a single polling loop and the last one unmounted stops it.
// The notifier, which runs headless, calls fetchNpsFeedShared() on its own
// clock; calls that land together share one request.

export const NPS_POLL_MS = 3 * 60_000;
const SHARED_MAX_AGE_MS = 30_000;

/** The server's own wording when it answers with an error ("NPS API rate limit reached — set NPS_API_KEY"). */
async function fetchNpsFeed(): Promise<NpsFeed> {
  const res = await fetch('/api/nps/feed');
  if (!res.ok) {
    let msg = `NPS feed unavailable (HTTP ${res.status})`;
    try {
      const j = (await res.json()) as { error?: string; detail?: string };
      if (j?.detail || j?.error) msg = j.detail ? `${j.error ?? 'NPS feed unavailable'}: ${j.detail}` : j.error!;
    } catch {
      /* non-JSON body */
    }
    throw new Error(msg);
  }
  return (await res.json()) as NpsFeed;
}

let shared: { at: number; promise: Promise<NpsFeed> } | null = null;

export function fetchNpsFeedShared(now = Date.now()): Promise<NpsFeed> {
  if (shared && now - shared.at < SHARED_MAX_AGE_MS) return shared.promise;
  const promise = fetchNpsFeed();
  const entry = { at: now, promise };
  shared = entry;
  promise.catch(() => {
    if (shared === entry) shared = null;
  });
  return promise;
}

export interface NpsFocus {
  parkCode: string;
  /** An alert or news id to open and scroll to, if any. */
  itemId: string | null;
  /** Bumped per request, so asking for the same item twice still scrolls to it. */
  seq: number;
}

interface NpsState {
  feed: NpsFeed | null;
  /** When the last answer arrived, epoch ms. */
  updated: number | null;
  loading: boolean;
  error: string | null;
  /** Run the parks' alerts and news through the ticker (persisted). */
  inTicker: boolean;
  setInTicker: (on: boolean) => void;
  /** The ticker runs only the parks' alerts — its BREAKING label toggles this (persisted). */
  tickerNpsOnly: boolean;
  setTickerNpsOnly: (on: boolean) => void;
  /** The panel's park filter: 'all' or a park code (persisted). */
  parkFilter: string;
  setParkFilter: (code: string) => void;
  /** What the National Parks panel should bring into view next. */
  focus: NpsFocus | null;
  focusItem: (parkCode: string, itemId: string | null) => void;
}

export const useNpsStore = create<NpsState>()(
  persist(
    (set) => ({
      feed: null,
      updated: null,
      loading: false,
      error: null,
      inTicker: true,
      setInTicker: (inTicker) => set({ inTicker }),
      tickerNpsOnly: false,
      setTickerNpsOnly: (tickerNpsOnly) => set({ tickerNpsOnly }),
      parkFilter: 'all',
      setParkFilter: (parkFilter) => set({ parkFilter }),
      focus: null,
      focusItem: (parkCode, itemId) =>
        set((s) => ({ focus: { parkCode, itemId, seq: (s.focus?.seq ?? 0) + 1 } })),
    }),
    {
      name: 'gsoc-nps',
      partialize: (s) => ({ inTicker: s.inTicker, parkFilter: s.parkFilter, tickerNpsOnly: s.tickerNpsOnly }),
    }
  )
);

export async function refreshNpsFeed(): Promise<void> {
  useNpsStore.setState({ loading: true });
  try {
    const feed = await fetchNpsFeedShared();
    useNpsStore.setState({ feed, updated: Date.now(), loading: false, error: null });
  } catch (err) {
    // Keep the last answer on screen; the error says it may be out of date.
    useNpsStore.setState({ loading: false, error: err instanceof Error ? err.message : String(err) });
  }
}

let consumers = 0;
let stopPolling: (() => void) | null = null;

/** Keep the NPS feed fresh while the calling component wants it. */
export function useNpsFeed(active = true): void {
  useEffect(() => {
    if (!active) return;
    consumers += 1;
    if (consumers === 1) stopPolling = startVisiblePolling(() => void refreshNpsFeed(), NPS_POLL_MS);
    return () => {
      consumers -= 1;
      if (consumers === 0) {
        stopPolling?.();
        stopPolling = null;
      }
    };
  }, [active]);
}
