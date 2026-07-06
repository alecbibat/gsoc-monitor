import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { startVisiblePolling } from '../../lib/poll';
import { useFlightsStatus } from './flightsStore';

function planeIconDataUri(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 2 L36 22 L58 40 L58 46 L36 38 L36 50 L46 58 L46 62 L32 58 L18 62 L18 58 L28 50 L28 38 L6 46 L6 40 L28 22 Z" fill="${color}" stroke="#05222b" stroke-width="2"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const AIRBORNE_ICON = planeIconDataUri('#ffb84d');
const GROUND_ICON = planeIconDataUri('#9fb4c4');

// Beyond this many seconds since the last ADS-B report the aircraft is treated
// as parked/offline: drawn on the ground, dimmed, with a "last seen" note.
const LIVE_WINDOW_SEC = 180;

function lastSeenText(sec: number): string {
  if (sec < LIVE_WINDOW_SEC) return 'live';
  const m = Math.round(sec / 60);
  if (m < 60) return `last seen ${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `last seen ${h}h ago`;
  return `last seen ${Math.round(h / 24)}d ago`;
}

export function FlightLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.flights);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const lastSigRef = useRef<string>('');

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('flights');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds) return;

    if (!active) {
      ds.entities.removeAll();
      lastSigRef.current = '';
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const data = await api.flightsByTail();
        if (cancelled) return;

        const setStatus = () =>
          useFlightsStatus.getState().setStatus({
            tooWideView: false,
            count: data.flights.length,
            error: null,
          });

        // Skip the teardown/redraw when nothing that affects rendering changed.
        const sig = data.flights
          .map(
            (f) =>
              `${f.icao24}:${f.latitude}:${f.longitude}:${f.track}:${f.onGround}:${
                f.lastSeenSec > LIVE_WINDOW_SEC
              }`
          )
          .join('|');
        if (sig === lastSigRef.current) {
          setStatus();
          return;
        }
        lastSigRef.current = sig;

        ds.entities.removeAll();

        for (const flight of data.flights) {
          if (flight.longitude == null || flight.latitude == null) continue;

          const stale = flight.lastSeenSec > LIVE_WINDOW_SEC;
          const grounded = flight.onGround || stale;
          // Airborne: draw at true altitude. Grounded/parked: clamp to surface.
          const altitude = grounded ? 0 : (flight.altitudeFt ?? 0) * 0.3048;
          const alpha = stale ? 0.5 : grounded ? 0.85 : 1;

          const entity = ds.entities.add({
            id: `flight-${flight.icao24}`,
            position: Cesium.Cartesian3.fromDegrees(flight.longitude, flight.latitude, altitude),
            billboard: {
              image: grounded ? GROUND_ICON : AIRBORNE_ICON,
              width: 30,
              height: 30,
              rotation: Cesium.Math.toRadians(-(flight.track ?? 0)),
              alignedAxis: Cesium.Cartesian3.UNIT_Z,
              color: Cesium.Color.WHITE.withAlpha(alpha),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: flight.registration ?? flight.callsign ?? '',
              font: '11px monospace',
              fillColor: Cesium.Color.fromCssColorString(grounded ? '#9fb4c4' : '#ffb84d').withAlpha(
                stale ? 0.7 : 1
              ),
              outlineColor: Cesium.Color.fromCssColorString('#05222b'),
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -26),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              translucencyByDistance: new Cesium.NearFarScalar(1e6, 1, 4e7, 0),
            },
          });
          attachPanelData(entity, {
            id: `flight-${flight.icao24}`,
            kind: 'flights',
            title: flight.registration ?? flight.callsign?.trim() ?? flight.icao24.toUpperCase(),
            subtitle: [
              flight.type,
              grounded ? 'On ground' : 'Airborne',
              lastSeenText(flight.lastSeenSec),
            ]
              .filter(Boolean)
              .join(' · '),
            payload: { ...flight },
          });
        }
        setStatus();
        viewer.scene.requestRender();
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load flights', err);
        useFlightsStatus.getState().setStatus({ error: 'Live flight feed unavailable' });
      }
    };

    const stopPolling = startVisiblePolling(() => void load(), 30_000);

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [viewer, active]);

  return null;
}
