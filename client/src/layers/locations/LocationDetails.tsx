import { useEffect } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { flyToLonLat } from '../../cesium/flyTo';

export interface LocationPayload {
  name: string;
  group: string;
  lat: number;
  lon: number;
  altitudeM: number;
  color: string;
  icon: string;
}

export function LocationDetails({ payload }: { payload: LocationPayload }) {
  const viewer = useCesiumViewer();

  useEffect(() => {
    if (!viewer) return;
    flyToLonLat(viewer, payload.lon, payload.lat, payload.altitudeM);
  }, [viewer, payload.lat, payload.lon, payload.altitudeM]);

  return (
    <div className="space-y-3 p-1">
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl"
          style={{ backgroundColor: `${payload.color}22`, border: `1px solid ${payload.color}55` }}
        >
          {payload.icon}
        </span>
        <div>
          <div className="text-[14px] font-semibold leading-tight text-white/90">{payload.name}</div>
          <div className="mt-0.5 text-[11px] text-white/45">{payload.group}</div>
        </div>
      </div>

      <div className="rounded-lg border border-white/8 bg-white/4 p-3 text-[11px] space-y-2">
        <div className="flex justify-between">
          <span className="text-white/40">Latitude</span>
          <span className="font-mono text-white/70">{payload.lat.toFixed(5)}°</span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/40">Longitude</span>
          <span className="font-mono text-white/70">{payload.lon.toFixed(5)}°</span>
        </div>
      </div>

      <button
        onClick={() => viewer && flyToLonLat(viewer, payload.lon, payload.lat, payload.altitudeM)}
        className="w-full rounded-lg border border-white/10 bg-white/5 py-2 text-[12px] font-medium text-white/60 transition hover:border-white/20 hover:bg-white/10 hover:text-white/90"
      >
        ↗ Fly here
      </button>
    </div>
  );
}
