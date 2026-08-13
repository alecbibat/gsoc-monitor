// Stage C PR 5 diagnostic, behind `?radarflow=1`.
//
// Flow is computed one PR before anything draws it, so without this there is no
// way to tell a correct measurement from a plausible-looking one until the warp
// lands — and by then a wrong flow looks like a broken warp. This computes the
// field for the current playhead pair and publishes a summary at
// `window.__radarFlow()`.
//
// Nothing renders. Nothing changes unless the flag is set.

import { useEffect } from 'react';
import { useCesiumViewer } from '../../../cesium/CesiumContext';
import { useLayersStore } from '../../../store/layersStore';
import { planWarmRegion, regionKey } from '../gl/composite';
import { buildTimeline, nowIndex, useRadarStore } from '../radarStore';
import { RADAR_MAX_LEVEL } from '../RainViewerImagery';
import { flowCacheSize, getFlow } from './flowCache';

const PROBE_MS = 1500;

export function radarFlowProbeEnabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('radarflow') === '1';
  } catch {
    return false;
  }
}

interface FlowReport {
  region: string | null;
  pair: string | null;
  coverage: number;
  cached: number;
  solveMs: number;
  /** Mean displacement over cells that had something to track, in plane px. */
  meanU: number;
  meanV: number;
  /** Largest single-cell displacement, a smoke test for runaway vectors. */
  peak: number;
  confidentCells: number;
  totalCells: number;
  note: string;
}

let last: FlowReport = {
  region: null,
  pair: null,
  coverage: 0,
  cached: 0,
  solveMs: 0,
  meanU: 0,
  meanV: 0,
  peak: 0,
  confidentCells: 0,
  totalCells: 0,
  note: 'no flow computed yet',
};

export function FlowProbe() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.radar);
  const host = useRadarStore((s) => s.host);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !active || !host) return;
    (globalThis as unknown as Record<string, unknown>).__radarFlow = () => ({
      ...last,
      cached: flowCacheSize(),
    });

    let disposed = false;
    let busy = false;
    const timer = window.setInterval(() => {
      if (disposed || busy || viewer.isDestroyed()) return;
      const s = useRadarStore.getState();
      const timeline = buildTimeline(s);
      if (timeline.length < 2) return;
      // Clamped to the OBSERVED range, not to the timeline's end. Since PR 8 the
      // timeline carries forecast frames whose paths are sentinels with no tiles
      // behind them; feeding one to planWarmRegion finds nothing warm and this
      // reports a permanent "no region decoded" whenever the playhead sits past
      // "now".
      const lastPair = nowIndex(timeline) - 1;
      if (lastPair < 0) return;
      const i = Math.min(Math.max(0, s.currentIndex), lastPair);
      const a = timeline[i].frame.path;
      const b = timeline[i + 1].frame.path;
      // Ask for a region that is decoded for BOTH frames — flow measured from
      // holes is worse than no flow at all.
      const region = planWarmRegion(RADAR_MAX_LEVEL, [a, b]);
      if (!region) {
        last = { ...last, note: 'no region decoded for this pair yet' };
        return;
      }

      busy = true;
      void getFlow(region, a, b)
        .then((flow) => {
          if (disposed) return;
          if (!flow) {
            last = {
              ...last,
              region: regionKey(region),
              pair: `${a} > ${b}`,
              note: 'region not decoded enough to measure — dissolve fallback',
            };
            return;
          }
          let su = 0;
          let sv = 0;
          let sw = 0;
          let peak = 0;
          for (let c = 0; c < flow.u.length; c++) {
            const mag = Math.hypot(flow.u[c], flow.v[c]);
            if (mag > peak) peak = mag;
            const w = flow.confidence[c];
            if (w > 0.05) {
              su += flow.u[c] * w;
              sv += flow.v[c] * w;
              sw += w;
            }
          }
          last = {
            region: regionKey(region),
            pair: `${a} > ${b}`,
            coverage: +flow.coverage.toFixed(3),
            cached: flowCacheSize(),
            solveMs: flow.ms,
            meanU: +(sw ? su / sw : 0).toFixed(2),
            meanV: +(sw ? sv / sw : 0).toFixed(2),
            peak: +peak.toFixed(2),
            confidentCells: Math.round(sw),
            totalCells: flow.u.length,
            note: `plane ${flow.planeWidth}x${flow.planeHeight}`,
          };
        })
        .catch((err) => {
          last = { ...last, note: `flow failed: ${String(err).slice(0, 120)}` };
        })
        .finally(() => {
          busy = false;
        });
    }, PROBE_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [viewer, active, host]);

  return null;
}
