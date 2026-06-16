import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { useFlightsStatus } from './flightsStore';
import type { FlightState } from '../../types';

const MAX_VIEW_AREA_DEG2 = 4000;

function planeIconDataUri(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 2 L36 22 L58 40 L58 46 L36 38 L36 50 L46 58 L46 62 L32 58 L18 62 L18 58 L28 50 L28 38 L6 46 L6 40 L28 22 Z" fill="${color}" stroke="#05222b" stroke-width="2"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const NORMAL_ICON = planeIconDataUri('#3ddcff');
const FAVORITE_ICON = planeIconDataUri('#ffb84d');

function parseState(arr: unknown[]): FlightState {
  return {
    icao24: String(arr[0]),
    callsign: (arr[1] as string | null) ?? null,
    originCountry: String(arr[2] ?? ''),
    longitude: arr[5] as number | null,
    latitude: arr[6] as number | null,
    baroAltitude: arr[7] as number | null,
    onGround: Boolean(arr[8]),
    velocity: arr[9] as number | null,
    trueTrack: arr[10] as number | null,
    verticalRate: arr[11] as number | null,
    lastContact: Number(arr[4] ?? 0),
  };
}

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
      const rect = viewer!.camera.computeViewRectangle();
      if (!rect) return;

      const bbox = {
        lamin: Cesium.Math.toDegrees(rect.south),
        lomin: Cesium.Math.toDegrees(rect.west),
        lamax: Cesium.Math.toDegrees(rect.north),
        lomax: Cesium.Math.toDegrees(rect.east),
      };
      const area = (bbox.lamax - bbox.lamin) * (bbox.lomax - bbox.lomin);

      if (area > MAX_VIEW_AREA_DEG2) {
        ds.entities.removeAll();
        useFlightsStatus.getState().setStatus({ tooWideView: true, count: 0 });
        viewer!.scene.requestRender();
        return;
      }

      try {
        const data = await api.flights(bbox);
        if (cancelled) return;
        ds.entities.removeAll();
        const states = (data.states ?? []).map(parseState);
        const visible = favoritesOnly
          ? states.filter((s) => favorites.includes(s.icao24))
          : states;

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
              // OpenSky true_track is degrees clockwise from north; Cesium's
              // rotation (with alignedAxis = UNIT_Z) is counter-clockwise,
              // hence the negation.
              rotation: Cesium.Math.toRadians(-(flight.trueTrack ?? 0)),
              alignedAxis: Cesium.Cartesian3.UNIT_Z,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
          attachPanelData(entity, {
            id: `flight-${flight.icao24}`,
            kind: 'flights',
            title: flight.callsign?.trim() || flight.icao24.toUpperCase(),
            subtitle: flight.originCountry,
            payload: { ...flight },
          });
        }
        useFlightsStatus.getState().setStatus({ tooWideView: false, count: visible.length });
        viewer!.scene.requestRender();
      } catch (err) {
        console.error('Failed to load flights', err);
      }
    }

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
