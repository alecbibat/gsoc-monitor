import { useEffect } from 'react';
import { useRiskReportStore } from './riskReportStore';
import { assembleWildfireReport } from './assembleWildfire';
import { assembleFloodReport } from './assembleFlood';
import { RiskReportView } from './RiskReportView';
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
    const run =
      hazard === 'flood'
        ? assembleFloodReport(target, onFeed, controller.signal)
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
