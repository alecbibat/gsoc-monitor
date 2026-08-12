// Keeps the radar store's frame manifest fresh while the layer is on.
//
// RainViewer republishes an identical manifest on most polls, and `setManifest`
// compares signatures before writing, so a poll that changes nothing produces no
// store update and no re-render — which is what keeps engine v2's two layers
// untouched across a rotation.

import { useEffect } from 'react';
import { api } from '../../api/client';
import { startVisiblePolling } from '../../lib/poll';
import { useRadarStore } from './radarStore';

const POLL_MS = 2 * 60_000;

export function useRadarManifest(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => {
      try {
        const manifest = await api.radarManifest();
        if (cancelled) return;
        useRadarStore
          .getState()
          .setManifest(
            manifest.host,
            manifest.radar.past,
            manifest.radar.nowcast ?? [],
            manifest.satellite?.infrared ?? []
          );
      } catch (err) {
        console.error('Failed to load radar manifest', err);
      }
    };
    const stopPolling = startVisiblePolling(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [active]);
}
