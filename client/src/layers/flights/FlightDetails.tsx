import { useLayersStore } from '../../store/layersStore';

interface Props {
  payload: {
    icao24: string;
    callsign: string | null;
    registration: string | null;
    type: string | null;
    altitudeFt: number | null;
    onGround: boolean;
    groundSpeedKt: number | null;
    track: number | null;
    verticalRateFpm: number | null;
    squawk: string | null;
    lastSeenSec: number;
  };
}

export function FlightDetails({ payload }: Props) {
  const favorites = useLayersStore((s) => s.flightFavorites);
  const toggleFavorite = useLayersStore((s) => s.toggleFlightFavorite);
  const isFavorite = favorites.includes(payload.icao24);

  const num = (n: number | null, suffix: string) =>
    n != null ? `${Math.round(n).toLocaleString()} ${suffix}` : '—';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xl font-bold tracking-wide">
          {payload.callsign?.trim() || payload.registration || payload.icao24.toUpperCase()}
        </span>
        <button
          onClick={() => toggleFavorite(payload.icao24)}
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
        <dt className="text-white/40">Registration</dt>
        <dd>{payload.registration || '—'}</dd>

        <dt className="text-white/40">Aircraft</dt>
        <dd>{payload.type || '—'}</dd>

        <dt className="text-white/40">Status</dt>
        <dd>{payload.onGround ? 'On ground' : 'Airborne'}</dd>

        <dt className="text-white/40">Altitude</dt>
        <dd>{payload.onGround ? 'Ground' : num(payload.altitudeFt, 'ft')}</dd>

        <dt className="text-white/40">Ground speed</dt>
        <dd>{num(payload.groundSpeedKt, 'kt')}</dd>

        <dt className="text-white/40">Heading</dt>
        <dd>{payload.track != null ? `${Math.round(payload.track)}°` : '—'}</dd>

        <dt className="text-white/40">Vertical rate</dt>
        <dd>{num(payload.verticalRateFpm, 'ft/min')}</dd>

        <dt className="text-white/40">Squawk</dt>
        <dd className="font-mono">{payload.squawk || '—'}</dd>

        <dt className="text-white/40">ICAO24</dt>
        <dd className="font-mono">{payload.icao24}</dd>

        <dt className="text-white/40">Last seen</dt>
        <dd>{Math.round(payload.lastSeenSec)}s ago</dd>
      </dl>
    </div>
  );
}
