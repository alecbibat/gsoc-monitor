import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { useFlightsStatus } from './flightsStore';

// adsb.fi caps the search radius at 250 NM; if the viewport is wider than that
// we ask the user to zoom in rather than show a misleading partial slice.
const MAX_RADIUS_NM = 250;

function planeIconDataUri(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 2 L36 22 L58 40 L58 46 L36 38 L36 50 L46 58 L46 62 L32 58 L18 62 L18 58 L28 50 L28 38 L6 46 L6 40 L28 22 Z" fill="${color}" stroke="#05222b" stroke-width="2"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const NORMAL_ICON = planeIconDataUri('#3ddcff');
const FAVORITE_ICON = planeIconDataUri('#ffb84d');

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (handle) clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  };
}

export function FlightLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.flights);
  const favoritesOnly = useLayersStore((s) => s.flightFavoritesOnly);
  const favorites = useLayersStore((s) => s.flightFavorites);
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
      const rect = viewer.camera.computeViewRectangle();
      if (!rect) return;

      const north = Cesium.Math.toDegrees(rect.north);
      const south = Cesium.Math.toDegrees(rect.south);
      const west = Cesium.Math.toDegrees(rect.west);
      const east = Cesium.Math.toDegrees(rect.east);

      const centerLat = (north + south) / 2;
      // Longitude span, accounting for a viewport that crosses the antimeridian.
      const lonSpan = east >= west ? east - west : east + 360 - west;
      let centerLon = west + lonSpan / 2;
      if (centerLon > 180) centerLon -= 360;

      // ~60 NM per degree of latitude; longitude degrees shrink by cos(lat).
      const latHalfNm = ((north - south) / 2) * 60;
      const lonHalfNm = (lonSpan / 2) * 60 * Math.cos(Cesium.Math.toRadians(centerLat));
      const radiusNm = Math.ceil(Math.sqrt(latHalfNm * latHalfNm + lonHalfNm * lonHalfNm));

      if (!Number.isFinite(radiusNm) || radiusNm > MAX_RADIUS_NM) {
        ds.entities.removeAll();
        useFlightsStatus.getState().setStatus({ tooWideView: true, count: 0, error: null });
        viewer.scene.requestRender();
        return;
      }

      try {
        const data = await api.flights(centerLat, centerLon, Math.max(1, radiusNm));
        if (cancelled) return;
        ds.entities.removeAll();

        const visible = favoritesOnly
          ? data.flights.filter((f) => favorites.includes(f.icao24))
          : data.flights;

        for (const flight of visible) {
          if (flight.longitude == null || flight.latitude == null) continue;
          const isFavorite = favorites.includes(flight.icao24);
          const entity = ds.entities.add({
            id: `flight-${flight.icao24}`,
            position: Cesium.Cartesian3.fromDegrees(flight.longitude, flight.latitude, 0),
            billboard: {
              image: isFavorite ? FAVORITE_ICON : NORMAL_ICON,
              width: isFavorite ? 30 : 24,
              height: isFavorite ? 30 : 24,
              // ADS-B track is degrees clockwise from north; Cesium billboard
              // rotation (with alignedAxis = UNIT_Z) is counter-clockwise.
              rotation: Cesium.Math.toRadians(-(flight.track ?? 0)),
              alignedAxis: Cesium.Cartesian3.UNIT_Z,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
          attachPanelData(entity, {
            id: `flight-${flight.icao24}`,
            kind: 'flights',
            title: flight.callsign?.trim() || flight.registration || flight.icao24.toUpperCase(),
            subtitle: [flight.type, flight.registration].filter(Boolean).join(' · '),
            payload: { ...flight },
          });
        }
        useFlightsStatus.getState().setStatus({
          tooWideView: false,
          count: visible.length,
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
    const debouncedLoad = debounce(load, 800);
    viewer.camera.moveEnd.addEventListener(debouncedLoad);
    const interval = setInterval(load, 15_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      viewer.camera.moveEnd.removeEventListener(debouncedLoad);
    };
  }, [viewer, active, favoritesOnly, favorites]);

  return null;
}
