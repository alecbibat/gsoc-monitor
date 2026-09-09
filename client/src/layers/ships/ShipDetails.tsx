import { useLayersStore } from '../../store/layersStore';
import { shipTypeLabel } from './ShipLayer';
import { ShipClassCard } from './ShipClassCard';

const NAV_STATUS: Record<number, string> = {
  0: 'Underway (engine)',
  1: 'At anchor',
  2: 'Not under command',
  3: 'Restricted maneuverability',
  4: 'Constrained by draught',
  5: 'Moored',
  6: 'Aground',
  7: 'Fishing',
  8: 'Underway (sailing)',
  15: 'Not defined',
};

// Which feed the shown position came from — the first thing to know when a
// marker looks wrong (coastal live AIS vs the satellite-backed scrape).
const SOURCE_LABEL: Record<string, string> = {
  aisstream: 'Live AIS (coastal receivers)',
  cruisemapper: 'CruiseMapper (satellite AIS)',
  vesselfinder: 'VesselFinder',
  myshiptracking: 'MyShipTracking',
  snapshot: 'Restored last-known',
};

interface Props {
  payload: {
    mmsi: string;
    imo: number | null;
    name: string | null;
    callsign: string | null;
    shipType: number | null;
    latitude: number;
    longitude: number;
    speedKt: number | null;
    heading: number | null;
    course: number | null;
    navStatus: number | null;
    destination: string | null;
    etaUtc?: number | null;
    etaText?: string | null;
    lastSeenSec: number;
    source?: string | null;
    receivedAt?: number | null;
  };
}

export function ShipDetails({ payload }: Props) {
  const favorites = useLayersStore((s) => s.shipFavorites);
  const toggleFavorite = useLayersStore((s) => s.toggleShipFavorite);
  const isFavorite = favorites.includes(payload.mmsi);

  const num = (n: number | null, suffix: string, decimals = 0) =>
    n != null ? `${n.toFixed(decimals)} ${suffix}` : '—';

  const fmtAge = (sec: number) => {
    if (sec < 90) return `${Math.round(sec)}s ago`;
    if (sec < 5400) return `${Math.round(sec / 60)}m ago`;
    if (sec < 172800) return `${Math.round(sec / 3600)}h ago`;
    return `${Math.round(sec / 86400)}d ago`;
  };
  const isStale = payload.lastSeenSec > 20 * 60;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-bold tracking-wide">
            {payload.name?.trim() || `MMSI ${payload.mmsi}`}
          </div>
        </div>
        <button
          onClick={() => toggleFavorite(payload.mmsi)}
          className={`rounded px-2 py-1 text-xs font-medium transition ${
            isFavorite
              ? 'bg-accent/20 text-accent'
              : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
          }`}
        >
          {isFavorite ? '★ Favorited' : '☆ Add favorite'}
        </button>
      </div>

      <ShipClassCard mmsi={payload.mmsi} />

      <dl className="grid grid-cols-2 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">IMO</dt>
        <dd className="font-mono">{payload.imo ?? '—'}</dd>

        <dt className="text-white/40">MMSI</dt>
        <dd className="font-mono">{payload.mmsi}</dd>

        <dt className="text-white/40">Type</dt>
        <dd>{shipTypeLabel(payload.shipType)}</dd>

        <dt className="text-white/40">Call sign</dt>
        <dd className="font-mono">{payload.callsign || '—'}</dd>

        <dt className="text-white/40">Status</dt>
        <dd>
          {payload.navStatus != null
            ? (NAV_STATUS[payload.navStatus] ?? `Code ${payload.navStatus}`)
            : '—'}
        </dd>

        <dt className="text-white/40">Speed</dt>
        <dd>{num(payload.speedKt, 'kt', 1)}</dd>

        <dt className="text-white/40">Heading</dt>
        <dd>{payload.heading != null ? `${Math.round(payload.heading)}°` : '—'}</dd>

        <dt className="text-white/40">Course (COG)</dt>
        <dd>{payload.course != null ? `${Math.round(payload.course)}°` : '—'}</dd>

        <dt className="text-white/40">Destination</dt>
        <dd className="truncate">{payload.destination?.trim() || '—'}</dd>

        <dt className="text-white/40">ETA</dt>
        <dd>
          {/* An expired parsed ETA also suppresses the raw text — it's the
              same stale ETA, just year-less and more misleading. */}
          {payload.etaUtc != null && payload.etaUtc > Date.now() - 12 * 3600_000
            ? `${new Date(payload.etaUtc).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })} (local)`
            : payload.etaUtc == null && payload.etaText
              ? payload.etaText
              : '—'}
        </dd>

        <dt className="text-white/40">Position</dt>
        <dd className="font-mono text-[12px]">
          {payload.latitude.toFixed(4)}°, {payload.longitude.toFixed(4)}°
        </dd>

        <dt className="text-white/40">Last AIS</dt>
        <dd className={isStale ? 'text-amber-300/90' : undefined}>{fmtAge(payload.lastSeenSec)}</dd>

        <dt className="text-white/40">Source</dt>
        <dd>{payload.source ? (SOURCE_LABEL[payload.source] ?? payload.source) : '—'}</dd>
      </dl>

      {isStale && (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200/80">
          Showing last known position — this vessel is likely outside coastal AIS
          range and will update when it reports again.
        </div>
      )}
    </div>
  );
}
