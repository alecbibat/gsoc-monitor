import { useLayersStore } from '../../store/layersStore';
import { shipTypeLabel } from './ShipLayer';

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

interface Props {
  payload: {
    mmsi: string;
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
    lastSeenSec: number;
  };
}

export function ShipDetails({ payload }: Props) {
  const favorites = useLayersStore((s) => s.shipFavorites);
  const toggleFavorite = useLayersStore((s) => s.toggleShipFavorite);
  const isFavorite = favorites.includes(payload.mmsi);

  const num = (n: number | null, suffix: string, decimals = 0) =>
    n != null ? `${n.toFixed(decimals)} ${suffix}` : '—';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-bold tracking-wide">
            {payload.name?.trim() || `MMSI ${payload.mmsi}`}
          </div>
          {payload.name && (
            <div className="font-mono text-[11px] text-white/40">{payload.mmsi}</div>
          )}
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

      <dl className="grid grid-cols-2 gap-y-1.5 text-[13px]">
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

        <dt className="text-white/40">Position</dt>
        <dd className="font-mono text-[12px]">
          {payload.latitude.toFixed(4)}°, {payload.longitude.toFixed(4)}°
        </dd>

        <dt className="text-white/40">Last AIS</dt>
        <dd>{Math.round(payload.lastSeenSec)}s ago</dd>
      </dl>
    </div>
  );
}
