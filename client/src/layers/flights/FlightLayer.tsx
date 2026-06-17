import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { useFlightsStatus } from './flightsStore';

// These are always shown worldwide regardless of camera viewport (no zoom gate).
const TRACKED_TAILS = new Set(['N10AZ', 'N14NA', 'N154LA']);

function planeIconDataUri(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 2 L36 22 L58 40 L58 46 L36 38 L36 50 L46 58 L46 62 L32 58 L18 62 L18 58 L28 50 L28 38 L6 46 L6 40 L28 22 Z" fill="${color}" stroke="#05222b" stroke-width="2"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Tracked tails get an amber icon; unknown aircraft (shouldn't normally appear) get blue.
const TRACKED_ICON = planeIconDataUri('#ffb84d');
const DEFAULT_ICON = planeIconDataUri('#3ddcff');

export function FlightLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.flights);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

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
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const data = await api.flightsByTail();
        if (cancelled) return;
        ds.entities.removeAll();

        for (const flight of data.flights) {
          if (flight.longitude == null || flight.latitude == null) continue;
          const isTracked =
            (flight.registration && TRACKED_TAILS.has(flight.registration.trim())) ||
            (flight.callsign && TRACKED_TAILS.has(flight.callsign.trim()));
          const entity = ds.entities.add({
            id: `flight-${flight.icao24}`,
            position: Cesium.Cartesian3.fromDegrees(flight.longitude, flight.latitude, 0),
            billboard: {
              image: isTracked ? TRACKED_ICON : DEFAULT_ICON,
              width: 30,
              height: 30,
              rotation: Cesium.Math.toRadians(-(flight.track ?? 0)),
              alignedAxis: Cesium.Cartesian3.UNIT_Z,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: flight.registration ?? flight.callsign ?? '',
              font: '11px monospace',
              fillColor: Cesium.Color.fromCssColorString('#ffb84d'),
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
            subtitle: [flight.type, flight.onGround ? 'On ground' : 'Airborne']
              .filter(Boolean)
              .join(' · '),
            payload: { ...flight },
          });
        }
        useFlightsStatus.getState().setStatus({
          tooWideView: false,
          count: data.flights.length,
          error: null,
        });
        viewer.scene.requestRender();
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load flights', err);
        useFlightsStatus.getState().setStatus({ error: 'Live flight feed unavailable' });
      }
    };

    load();
    const interval = setInterval(load, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [viewer, active]);

  return null;
}
