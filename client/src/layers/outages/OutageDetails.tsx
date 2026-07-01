import { outageColor } from './outagesData';

interface Props {
  payload: {
    utility: string;
    lat: number;
    lon: number;
    start: number | null;
    estimatedRestore: number | null;
    cause: string | null;
    customers: number | null;
    county: string | null;
    status: string | null;
    type: string | null;
  };
}

function fmtDateTime(ms: number | null): string | null {
  if (!ms) return null;
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// A compact "2h 15m" style duration for a signed millisecond delta.
function fmtSpan(ms: number): string {
  const mins = Math.round(Math.abs(ms) / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function OutageDetails({ payload }: Props) {
  const color = outageColor(payload.type);
  const now = Date.now();
  const started = fmtDateTime(payload.start);
  const restore = fmtDateTime(payload.estimatedRestore);

  // "restores in 2h" / "overdue by 30m" relative to the ETR.
  let restoreRel: string | null = null;
  if (payload.estimatedRestore) {
    const delta = payload.estimatedRestore - now;
    restoreRel = delta >= 0 ? `in ${fmtSpan(delta)}` : `overdue ${fmtSpan(delta)}`;
  }
  const elapsed = payload.start ? `${fmtSpan(now - payload.start)} ago` : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="rounded px-2 py-0.5 text-xs font-semibold text-ink-950"
          style={{ backgroundColor: color }}
        >
          {payload.type ?? 'Outage'}
        </span>
        <span className="text-white/70">{payload.status ?? 'Power outage'}</span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums" style={{ color }}>
          {payload.customers != null ? payload.customers.toLocaleString() : '—'}
        </span>
        <span className="text-white/50">customers affected</span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">Utility</dt>
        <dd className="font-medium">{payload.utility}</dd>

        {started && (
          <>
            <dt className="text-white/40">Started</dt>
            <dd>
              {started}
              {elapsed && <span className="text-white/40"> · {elapsed}</span>}
            </dd>
          </>
        )}

        <dt className="text-white/40">Est. restore</dt>
        <dd>
          {restore ? (
            <>
              {restore}
              {restoreRel && (
                <span className={payload.estimatedRestore! < now ? 'text-accent-danger' : 'text-white/40'}>
                  {' '}
                  · {restoreRel}
                </span>
              )}
            </>
          ) : (
            <span className="text-white/40">Not provided</span>
          )}
        </dd>

        {payload.county && (
          <>
            <dt className="text-white/40">County</dt>
            <dd>{payload.county}</dd>
          </>
        )}
      </dl>

      {payload.cause && (
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-white/30">Cause</div>
          <p className="text-[12px] leading-relaxed text-white/70">{payload.cause}</p>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-white/40">
        Statewide outage data from the California Office of Emergency Services (Cal OES) public feed,
        aggregating the state’s electric utilities. California only. Times and restoration estimates
        come from each utility and update as they report.
      </p>

      <a
        href="https://gis.data.ca.gov/"
        target="_blank"
        rel="noreferrer"
        className="inline-block text-xs text-accent underline underline-offset-2 hover:text-accent/80"
      >
        Cal OES open data &rarr;
      </a>
    </div>
  );
}
