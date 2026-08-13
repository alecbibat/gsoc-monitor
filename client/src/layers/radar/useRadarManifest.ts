// Keeps the radar store's frame manifest fresh while the layer is on.
//
// RainViewer republishes an identical manifest on most polls, and `setManifest`
// compares signatures before writing, so a poll that changes nothing produces no
// store update and no re-render — which is what keeps engine v2's two layers
// untouched across a rotation.

import { useEffect } from 'react';
import type { RadarFrame } from '../../types';
import { api } from '../../api/client';
import { startVisiblePolling } from '../../lib/poll';
import { radarEngine } from './engineFlag';
import { motionEnabled } from './motion/MotionLayer';
import { buildForecastFrames } from './nowcast/forecast';
import { useRadarStore } from './radarStore';

const POLL_MS = 2 * 60_000;

// What goes in the timeline's forecast zone.
//
// Upstream frames win if there are any: a real nowcast product knows things
// advection cannot, and Stage 0's finding that RainViewer publishes none may
// not hold forever. Failing that we compute our own by advecting the newest
// observation — but only where something can actually draw them. Engine v1
// serves the timeline as one imagery layer per frame straight from the CDN and
// has no way to render a frame that was never downloaded; with motion disabled
// (the kill switch, or an OS request for reduced animation) nothing computes
// them either.
//
// In both of those cases the forecast zone is simply ABSENT rather than present
// and empty. Offering a stretch of timeline that can never show anything is
// worse than not offering it.
function forecastFrames(past: RadarFrame[], upstream: RadarFrame[] | undefined): RadarFrame[] {
  if (upstream && upstream.length > 0) return upstream;
  if (radarEngine() !== 'v2' || !motionEnabled()) return [];
  // Anchored to the INCOMING newest frame, not the one already in the store:
  // this runs before setManifest writes, and a forecast pinned to the previous
  // rotation's "now" would sit ten minutes in the past.
  const newest = past[past.length - 1];
  return newest ? buildForecastFrames(newest.time) : [];
}

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
            forecastFrames(manifest.radar.past, manifest.radar.nowcast)
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
