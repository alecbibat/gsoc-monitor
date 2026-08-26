import { useState } from 'react';
import { useLayersStore } from '../../store/layersStore';
import type { AircraftInfo } from '../../types';
import { aircraftTypeText } from './flightMarkers';

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
    aircraftInfo?: AircraftInfo | null;
  };
}

export function FlightDetails({ payload }: Props) {
  const favorites = useLayersStore((s) => s.flightFavorites);
  const toggleFavorite = useLayersStore((s) => s.toggleFlightFavorite);
  const isFavorite = favorites.includes(payload.icao24);
  // A dead CDN link should drop the whole photo block, caption included —
  // keyed by URL so a broken image for one aircraft can't suppress another's
  // if the panel is ever reused with a different payload.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);

  const num = (n: number | null, suffix: string) =>
    n != null ? `${Math.round(n).toLocaleString()} ${suffix}` : '—';

  const info = payload.aircraftInfo ?? null;
  const typeName = aircraftTypeText(info, payload.type);
  const typeCode = info?.icaoType ?? payload.type;
  const photo = info?.photo && info.photo.src !== brokenSrc ? info.photo : null;

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

      {photo && (
        // Planespotters' terms for the free photo API: show the photographer
        // and link the image back to its photo page.
        <a href={photo.link} target="_blank" rel="noreferrer" className="block">
          <img
            src={photo.src}
            alt={`${payload.registration ?? payload.icao24.toUpperCase()}${typeName ? ` — ${typeName}` : ''}`}
            loading="lazy"
            onError={() => setBrokenSrc(photo.src)}
            className="w-full rounded-md border border-white/10 object-cover"
          />
          <div className="mt-1 text-[10px] text-white/40">
            © {photo.photographer} · Planespotters.net
          </div>
        </a>
      )}

      <dl className="grid grid-cols-2 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">Registration</dt>
        <dd>{payload.registration || '—'}</dd>

        <dt className="text-white/40">Aircraft</dt>
        <dd>
          {typeName
            ? typeCode && typeName !== typeCode
              ? `${typeName} (${typeCode})`
              : typeName
            : '—'}
        </dd>

        {info?.owner && (
          <>
            <dt className="text-white/40">Operator</dt>
            <dd>{info.owner}</dd>
          </>
        )}

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
