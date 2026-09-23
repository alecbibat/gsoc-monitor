import { useEffect, useMemo, useState } from 'react';
import type { EciVec3 } from 'satellite.js';
import { getSatlib, loadSatlib, type SatLib } from './satlib';

interface Props {
  payload: {
    name: string;
    satnum: string;
    intlDesig: string;
    line1: string;
    line2: string;
    group: string;
  };
}

const MU = 398_600.4418; // Earth's gravitational parameter, km^3/s^2
const RE = 6_378.137; // Earth's equatorial radius, km

interface Live {
  lat: number;
  lon: number;
  altKm: number;
  speedKmS: number;
}

// satellite.js comes from the satlib cache rather than a static import, so the
// shared panel chunk doesn't pull it in for every panel kind. The body is a
// separate component so its hooks never run conditionally.
export function SatelliteDetails({ payload }: Props) {
  const [sat, setSat] = useState<SatLib | null>(getSatlib);
  useEffect(() => {
    if (sat) return;
    // Defensive only. In practice the layer has already loaded the library.
    let alive = true;
    loadSatlib().then(
      (m) => {
        if (alive) setSat(m);
      },
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [sat]);
  if (!sat) return null;
  return <SatelliteDetailsBody payload={payload} sat={sat} />;
}

function SatelliteDetailsBody({ payload, sat }: Props & { sat: SatLib }) {
  // The satrec is derived once from the TLE; SGP4 propagation is cheap so the
  // panel re-derives a live position every second to feel as alive as the map.
  const satrec = useMemo(
    () => sat.twoline2satrec(payload.line1, payload.line2),
    [sat, payload.line1, payload.line2]
  );

  const orbital = useMemo(() => {
    const periodMin = (2 * Math.PI) / satrec.no;
    const inclinationDeg = (satrec.inclo * 180) / Math.PI;
    const ecc = satrec.ecco;
    // Semi-major axis from mean motion (Kepler's third law), then the apsides.
    const nRadPerSec = satrec.no / 60;
    const a = Math.cbrt(MU / (nRadPerSec * nRadPerSec));
    return {
      periodMin,
      inclinationDeg,
      ecc,
      apogeeKm: a * (1 + ecc) - RE,
      perigeeKm: a * (1 - ecc) - RE,
    };
  }, [satrec]);

  const [live, setLive] = useState<Live | null>(null);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const pv = sat.propagate(satrec, now);
      if (typeof pv.position === 'boolean' || typeof pv.velocity === 'boolean') {
        setLive(null);
        return;
      }
      const geo = sat.eciToGeodetic(pv.position as EciVec3<number>, sat.gstime(now));
      const v = pv.velocity as EciVec3<number>;
      setLive({
        lat: sat.degreesLat(geo.latitude),
        lon: sat.degreesLong(geo.longitude),
        altKm: geo.height,
        speedKmS: Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z),
      });
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [sat, satrec]);

  const latStr = live ? `${Math.abs(live.lat).toFixed(2)}° ${live.lat >= 0 ? 'N' : 'S'}` : '—';
  const lonStr = live ? `${Math.abs(live.lon).toFixed(2)}° ${live.lon >= 0 ? 'E' : 'W'}` : '—';

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xl font-bold tracking-wide">{payload.name}</div>
        <div className="text-[11px] uppercase tracking-wider text-white/35">
          {payload.group} satellite
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">Latitude</dt>
        <dd className="font-mono">{latStr}</dd>

        <dt className="text-white/40">Longitude</dt>
        <dd className="font-mono">{lonStr}</dd>

        <dt className="text-white/40">Altitude</dt>
        <dd>{live ? `${Math.round(live.altKm).toLocaleString()} km` : '—'}</dd>

        <dt className="text-white/40">Speed</dt>
        <dd>
          {live
            ? `${live.speedKmS.toFixed(2)} km/s · ${Math.round(live.speedKmS * 3600).toLocaleString()} km/h`
            : '—'}
        </dd>

        <dt className="text-white/40">Period</dt>
        <dd>{orbital.periodMin.toFixed(1)} min</dd>

        <dt className="text-white/40">Inclination</dt>
        <dd>{orbital.inclinationDeg.toFixed(2)}°</dd>

        <dt className="text-white/40">Apogee</dt>
        <dd>{Math.round(orbital.apogeeKm).toLocaleString()} km</dd>

        <dt className="text-white/40">Perigee</dt>
        <dd>{Math.round(orbital.perigeeKm).toLocaleString()} km</dd>

        <dt className="text-white/40">NORAD ID</dt>
        <dd className="font-mono">{payload.satnum}</dd>

        <dt className="text-white/40">Int'l desig.</dt>
        <dd className="font-mono">{payload.intlDesig || '—'}</dd>
      </dl>

      <p className="text-[11px] leading-relaxed text-white/35">
        Live position propagated from CelesTrak TLE via SGP4. Click the satellite on the globe to
        trace its orbit.
      </p>
    </div>
  );
}
