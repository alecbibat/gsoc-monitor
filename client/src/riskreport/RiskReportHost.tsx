import { useEffect } from 'react';
import { useRiskReportStore, type RiskReportData } from './riskReportStore';
import { assembleWildfireReport } from './assembleWildfire';
import { RiskReportView } from './RiskReportView';
import { importWithReload } from '../lib/lazyWithReload';
import type { FeedResult, RiskFeedId } from './feedManifest';

// Runs the hazard's assembly whenever a target opens; the view is a pure renderer.
export function RiskReportHost() {
  const target = useRiskReportStore((s) => s.target);
  const hazard = useRiskReportStore((s) => s.hazard);
  const status = useRiskReportStore((s) => s.status);

  useEffect(() => {
    if (!target || status !== 'loading') return;
    let cancelled = false;
    // Aborted on close/retarget so the abandoned run skips its map snapshots
    // (hundreds of tile requests + PNG encodes). The only other cleanup path
    // is status leaving 'loading', which happens after the run has settled.
    const controller = new AbortController();
    // The cancelled flag alone has a gap: open(B) commits before A's effect
    // cleanup runs, so a resolution landing in that window could pin A's data
    // under B's header. Identity-check the store's CURRENT target too — and
    // its hazard, so a wildfire run can never paint into a flood report of
    // the same property (or the reverse).
    const stillCurrent = () => {
      const s = useRiskReportStore.getState();
      return !cancelled && s.target === target && s.hazard === hazard;
    };
    // Feed outcomes stream in mid-assembly; the same identity guard keeps a
    // stale run from painting its progress under a newer target's header.
    const onFeed = (id: RiskFeedId, result: FeedResult) => {
      if (stillCurrent()) useRiskReportStore.getState().setFeedResult(id, result);
    };
    // The flood report's code is its own chunk, fetched only when one opens —
    // a wildfire report never downloads it. Its body chunk is warmed here too,
    // so the finished report doesn't wait on a second fetch.
    // A preload that fails is harmless: the view's lazy load retries and reloads.
    if (hazard === 'flood') import('./FloodReportBody').catch(() => {});
    const run: Promise<RiskReportData> =
      hazard === 'flood'
        ? importWithReload(() => import('./assembleFlood')).then((m) =>
            m.assembleFloodReport(target, onFeed, controller.signal)
          )
        : assembleWildfireReport(target, onFeed, controller.signal);
    run
      .then((data) => { if (stillCurrent()) useRiskReportStore.getState().setData(data); })
      .catch((e) => {
        if (stillCurrent()) {
          useRiskReportStore.getState().setError(e instanceof Error ? e.message : 'Report assembly failed');
        }
      });
    return () => { cancelled = true; controller.abort(); };
  }, [target, hazard, status]);

  return <RiskReportView />;
}
