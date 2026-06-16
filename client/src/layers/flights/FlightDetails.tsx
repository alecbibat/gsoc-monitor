import { useLayersStore } from '../../store/layersStore';

interface Props {
  payload: {
    icao24: string;
    callsign: string | null;
    originCountry: string;
    baroAltitude: number | null;
    velocity: number | null;
    trueTrack: number | null;
    verticalRate: number | null;
    onGround: boolean;
    lastContact: number;
  };
}

export function FlightDetails({ payload }: Props) {
  const favorites = useLayersStore((s) => s.flightFavorites);
  const toggleFavorite = useLayersStore((s) => s.toggleFlightFavorite);
  const isFavorite = favorites.includes(payload.icao24);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xl font-bold tracking-wide">
          {payload.callsign?.trim() || payload.icao24.toUpperCase()}
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
        <dt className="text-white/40">Origin country</dt>
        <dd>{payload.originCountry}</dd>

        <dt className="text-white/40">Status</dt>
        <dd>{payload.onGround ? 'On ground' : 'Airborne'}</dd>

        <dt className="text-white/40">Altitude</dt>
        <dd>{payload.baroAltitude != null ? `${Math.round(payload.baroAltitude)} m` : '—'}</dd>

        <dt className="text-white/40">Ground speed</dt>
        <dd>{payload.velocity != null ? `${Math.round(payload.velocity * 1.94384)} kt` : '—'}</dd>

        <dt className="text-white/40">Heading</dt>
        <dd>{payload.trueTrack != null ? `${Math.round(payload.trueTrack)}°` : '—'}</dd>

        <dt className="text-white/40">Vertical rate</dt>
        <dd>{payload.verticalRate != null ? `${payload.verticalRate.toFixed(1)} m/s` : '—'}</dd>

        <dt className="text-white/40">ICAO24</dt>
        <dd className="font-mono">{payload.icao24}</dd>

        <dt className="text-white/40">Last contact</dt>
        <dd>{new Date(payload.lastContact * 1000).toLocaleTimeString()}</dd>
      </dl>
    </div>
  );
}
