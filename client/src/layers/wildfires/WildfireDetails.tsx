import { containmentColor } from './wildfiresData';

interface Props {
  payload: {
    name: string;
    lat: number;
    lon: number;
    acres: number | null;
    contained: number | null;
    personnel: number | null;
    complexity: string | null;
    managementOrg: string | null;
    cause: string | null;
    discovered: number | null;
    state: string | null;
  };
}

function fmtAcres(a: number | null): string {
  if (a == null) return '—';
  return `${Math.round(a).toLocaleString()} ac`;
}
function fmtDate(ms: number | null): string | null {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
}
function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}

export function WildfireDetails({ payload }: Props) {
  const color = containmentColor(payload.contained);
  const discovered = fmtDate(payload.discovered);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="rounded px-2 py-0.5 text-xs font-semibold text-ink-950"
          style={{ backgroundColor: color }}
        >
          {payload.contained != null ? `${payload.contained}% contained` : 'Uncontained'}
        </span>
        <span className="text-white/70">Active wildfire</span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums" style={{ color }}>
          {payload.acres != null ? Math.round(payload.acres).toLocaleString() : '—'}
        </span>
        <span className="text-white/50">acres</span>
      </div>

      {/* Containment bar */}
      {payload.contained != null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full" style={{ width: `${payload.contained}%`, backgroundColor: color }} />
        </div>
      )}

      <dl className="grid grid-cols-2 gap-y-1.5 text-[13px]">
        {payload.personnel != null && (
          <>
            <dt className="text-white/40">Personnel</dt>
            <dd className="tabular-nums">{payload.personnel.toLocaleString()} assigned</dd>
          </>
        )}
        {payload.complexity && (
          <>
            <dt className="text-white/40">Complexity</dt>
            <dd>{payload.complexity}</dd>
          </>
        )}
        {payload.managementOrg && (
          <>
            <dt className="text-white/40">Managed by</dt>
            <dd className="truncate" title={payload.managementOrg}>
              {payload.managementOrg}
            </dd>
          </>
        )}
        {payload.cause && (
          <>
            <dt className="text-white/40">Cause</dt>
            <dd>{payload.cause}</dd>
          </>
        )}
        {discovered && (
          <>
            <dt className="text-white/40">Discovered</dt>
            <dd>{discovered}</dd>
          </>
        )}
        <dt className="text-white/40">Location</dt>
        <dd className="tabular-nums">
          {formatLat(payload.lat)} {formatLon(payload.lon)}
          {payload.state ? ` · ${payload.state}` : ''}
        </dd>
      </dl>

      <p className="text-[11px] leading-relaxed text-white/40">
        Named-incident data from the interagency WFIGS feed (NIFC), the official source behind the
        national fire picture. Acres, containment, and personnel update as incident-management teams
        file reports — usually daily.
      </p>

      <a
        href="https://inciweb.wildfire.gov/"
        target="_blank"
        rel="noreferrer"
        className="inline-block text-xs text-accent underline underline-offset-2 hover:text-accent/80"
      >
        Incident information (InciWeb) &rarr;
      </a>
    </div>
  );
}
