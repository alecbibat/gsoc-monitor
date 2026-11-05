import { useEffect } from 'react';
import { create } from 'zustand';
import { api } from '../../api/client';
import { startVisiblePolling } from '../../lib/poll';
import type { WebcamsFeed } from '../../types';

// The webcam catalog, shared by the map layer and the National Parks panel:
// the first reader to mount starts one polling loop, the last to unmount stops
// it (as with the NPS feed). The list barely changes; it is re-read for the
// per-camera status the server reports.

const POLL_MS = 5 * 60_000;

interface WebcamsState {
  feed: WebcamsFeed | null;
  error: string | null;
}

export const useWebcamsStore = create<WebcamsState>(() => ({ feed: null, error: null }));

export async function refreshWebcams(): Promise<void> {
  try {
    const feed = await api.webcams();
    useWebcamsStore.setState({ feed, error: null });
  } catch (err) {
    useWebcamsStore.setState({ error: err instanceof Error ? err.message : String(err) });
  }
}

let consumers = 0;
let stop: (() => void) | null = null;

export function useWebcamsFeed(active = true): void {
  useEffect(() => {
    if (!active) return;
    consumers += 1;
    if (consumers === 1) stop = startVisiblePolling(() => void refreshWebcams(), POLL_MS);
    return () => {
      consumers -= 1;
      if (consumers === 0) {
        stop?.();
        stop = null;
      }
    };
  }, [active]);
}
