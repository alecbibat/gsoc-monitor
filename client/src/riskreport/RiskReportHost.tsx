import { useEffect } from 'react';
import { useRiskReportStore } from './riskReportStore';
import { assembleWildfireReport } from './assembleWildfire';
import { RiskReportView } from './RiskReportView';

// Runs the assembly whenever a target opens; the view is a pure renderer.
export function RiskReportHost() {
  const target = useRiskReportStore((s) => s.target);
  const status = useRiskReportStore((s) => s.status);

  useEffect(() => {
    if (!target || status !== 'loading') return;
    let cancelled = false;
    // The cancelled flag alone has a gap: open(B) commits before A's effect
    // cleanup runs, so a resolution landing in that window could pin A's data
    // under B's header. Identity-check the store's CURRENT target too.
    const stillCurrent = () =>
      !cancelled && useRiskReportStore.getState().target === target;
    assembleWildfireReport(target, (id, result) => {
      // Feed outcomes stream in mid-assembly; the same identity guard keeps a
      // stale run from painting its progress under a newer target's header.
      if (stillCurrent()) useRiskReportStore.getState().setFeedResult(id, result);
    })
      .then((data) => { if (stillCurrent()) useRiskReportStore.getState().setData(data); })
      .catch((e) => {
        if (stillCurrent()) {
          useRiskReportStore.getState().setError(e instanceof Error ? e.message : 'Report assembly failed');
        }
      });
    return () => { cancelled = true; };
  }, [target, status]);

  return <RiskReportView />;
}
