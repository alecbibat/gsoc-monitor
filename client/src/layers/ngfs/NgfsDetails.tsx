import {
  ageClass,
  clockTime,
  footprintKm,
  formatMix,
  incidentTypeLabel,
  NGFS_OTHER,
  SCAN_INTERVAL_MS,
  SLOT_LABEL,
  trackedSince,
  type NgfsPanelPayload,
} from './ngfsMeta';

interface Props {
  payload: NgfsPanelPayload;
}


function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}`;
}

function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;
}

// "Oct 1, 14:32 PDT" in the viewer's zone.
function formatLocal(ms: number): string {
  const dt = new Date(ms);
  const datePart = dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const timePart = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const tz =
    new Intl.DateTimeFormat([], { timeZoneName: 'short' }).formatToParts(dt).find((p) => p.type === 'timeZoneName')
      ?.value ?? '';
  return `${datePart}, ${timePart}${tz ? ` ${tz}` : ''}`;
}

function ago(ms: number, now: number): string {
  const min = Math.max(0, Math.round((now - ms) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h >= 48) return `${Math.floor(h / 24)} days ago`;
  const m = min % 60;
  return m ? `${h} h ${m} min ago` : `${h} h ago`;
}

function mw(v: number | null): string {
  if (v == null) return '—';
  return v >= 10 ? `${Math.round(v).toLocaleString()} MW` : `${v.toFixed(1)} MW`;
}

export function NgfsDetails({ payload: p }: Props) {
  const now = Date.now();
  const age = ageClass(p.last, now);
  const color = p.wildland ? age.color : NGFS_OTHER.color;
  const size = footprintKm(p);
  const fuel = formatMix(p.fuel);
  const cover = formatMix(p.landCover);
  const incidentType = incidentTypeLabel(p.incidentType);
  const minutesSince = (now - p.last) / 60_000;
  const tracked = trackedSince(p.trackId);
  // Hot in the earliest scan the server has: it has been hot since before then.
  const hotBeforeHistory = p.first - p.historyFrom < SCAN_INTERVAL_MS;

  const headline = !p.wildland
    ? `${p.type} — not classed as wildland fire`
    : minutesSince < 15
      ? 'Heat in the latest satellite scans'
      : `Last seen ${ago(p.last, now)}`;
  const detail = !p.wildland
    ? 'NGFS attributes this heat to a known non-vegetation source (industry, a gas flare, an urban area or a volcano).'
    : minutesSince < 15
      ? 'GOES saw anomalous heat in this pixel within the last few scans.'
      : 'Not hot in the most recent scans. The fire may have died down, or cloud or smoke may be hiding it.';

  return (
    <div className="space-y-3">
      <div
        className="rounded-lg border px-2.5 py-2"
        style={{ borderColor: `${color}55`, backgroundColor: `${color}1a` }}
      >
        <div className="flex items-center gap-1.5 text-[13px] font-bold" style={{ color }}>
          <span>{p.wildland ? '🛰️' : '🏭'}</span>
          {headline}
        </div>
        <p className="pt-0.5 text-[11px] leading-snug text-white/55">{detail}</p>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-accent-warn">{mw(p.frp)}</span>
        <span className="text-white/50">fire radiative power, this pixel</span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">Classification</dt>
        <dd>{p.type}</dd>

        {p.incident && (
          <>
            <dt className="text-white/40">Incident</dt>
            <dd title="IRWIN incident NGFS matched this fire object to">
              {p.incident}
              {incidentType ? <span className="text-white/45"> · {incidentType}</span> : null}
            </dd>
          </>
        )}

        <dt className="text-white/40">Last detected</dt>
        <dd title={`${new Date(p.last).toISOString().replace('.000Z', 'Z')} (UTC)`}>
          {formatLocal(p.last)} <span className="text-white/45">· {ago(p.last, now)}</span>
        </dd>

        <dt className="text-white/40">Hot since</dt>
        <dd
          title={
            `Earliest scan with this pixel hot among the scans loaded for the last ${p.windowHours} h` +
            (hotBeforeHistory ? ', and it was already hot in the earliest one.' : '.')
          }
        >
          {hotBeforeHistory ? (
            <>
              before {clockTime(p.historyFrom)}{' '}
              <span className="text-white/45">
                · {p.historyComplete ? `start of the ${p.windowHours} h window` : 'earlier scans still loading'}
              </span>
            </>
          ) : (
            formatLocal(p.first)
          )}
        </dd>

        {tracked != null && (
          <>
            <dt className="text-white/40">Tracked since</dt>
            <dd title="When NGFS first detected this fire object (from its tracking id)">
              {formatLocal(tracked)} <span className="text-white/45">· {ago(tracked, now)}</span>
            </dd>
          </>
        )}

        <dt className="text-white/40">Persistence</dt>
        <dd className="tabular-nums" title="GOES scans CONUS every 5 minutes">
          Hot in {p.frames} scan{p.frames === 1 ? '' : 's'}
        </dd>

        <dt className="text-white/40">Peak FRP</dt>
        <dd className="tabular-nums">{mw(p.maxFrp)}</dd>

        {p.featureFrp != null && (
          <>
            <dt className="text-white/40">Fire object</dt>
            <dd className="tabular-nums" title={p.trackId ?? undefined}>
              {mw(p.featureFrp)} <span className="text-white/45">total, all its pixels</span>
            </dd>
          </>
        )}

        <dt className="text-white/40">Satellite</dt>
        <dd>
          {p.sat} <span className="text-white/45">· {SLOT_LABEL[p.slot]}</span>
        </dd>

        <dt className="text-white/40">Pixel</dt>
        <dd className="tabular-nums" title="Ground footprint of the satellite pixel (north–south × east–west)">
          {size ? `≈ ${size.ns.toFixed(1)} × ${size.ew.toFixed(1)} km` : '—'}
        </dd>

        {(p.county || p.state) && (
          <>
            <dt className="text-white/40">Area</dt>
            <dd>{[p.county, p.state].filter(Boolean).join(', ')}</dd>
          </>
        )}

        <dt className="text-white/40">Position</dt>
        <dd className="tabular-nums">
          {formatLat(p.lat)} {formatLon(p.lon)}
        </dd>

        {fuel && (
          <>
            <dt className="text-white/40">Fuels</dt>
            <dd className="text-[12px]" title="LANDFIRE fire-behavior fuel models (Anderson 13) inside the pixel">
              {fuel}
            </dd>
          </>
        )}

        {cover && (
          <>
            <dt className="text-white/40">Land cover</dt>
            <dd className="text-[12px]">{cover}</dd>
          </>
        )}

        {p.confidence && (
          <>
            <dt className="text-white/40">Confidence</dt>
            <dd className="capitalize">{p.confidence}</dd>
          </>
        )}
      </dl>

      <p className="text-[11px] leading-snug text-white/35">
        NOAA/CIMSS Next Generation Fire System (experimental), from GOES ABI scans every 5
        minutes. A detection means anomalous heat somewhere inside the outlined satellite pixel,
        not that the whole area is burning. Clouds and thick smoke can hide fires, so no detection
        does not mean no fire.
      </p>
    </div>
  );
}
