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
    assembleWildfireReport(target)
      .then((data) => { if (!cancelled) useRiskReportStore.getState().setData(data); })
      .catch((e) => {
        if (!cancelled) {
          useRiskReportStore.getState().setError(e instanceof Error ? e.message : 'Report assembly failed');
        }
      });
    return () => { cancelled = true; };
  }, [target, status]);

  return <RiskReportView />;
}
