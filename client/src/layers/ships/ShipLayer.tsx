import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { useShipsStatus } from './shipsStore';

// AIS global coverage; ships are globally distributed so a large max radius is fine.
const MAX_RADIUS_NM = 500;

// AIS ship type → category color
function shipColor(type: number | null): string {
  if (type === null) return '#8fc7d9';
  if (type >= 70 && type <= 79) return '#3ddcff'; // Cargo  — blue
  if (type >= 80 && type <= 89) return '#ff9d2e'; // Tanker — orange
  if (type >= 60 && type <= 69) return '#4dff91'; // Passenger — green
  if (type === 30) return '#ffd84d';              // Fishing — yellow
  if (type === 36 || type === 37) return '#ffd84d'; // Sailing — yellow
  if (type >= 50 && type <= 59) return '#c084fc'; // Special (pilot, rescue…) — purple
  if (type >= 40 && type <= 49) return '#ff5ad8'; // High-speed — pink
  return '#8fc7d9'; // Other — grey-blue
}

function shipIconDataUri(color: string, favorite: boolean): string {
  // Top-down ship silhouette: pointed bow at top, wider stern at bottom.
  const hull = 'M32 4 L46 20 L46 58 L18 58 L18 20 Z';
  const bridge = '<rect x="24" y="28" width="16" height="12" fill="rgba(5,34,43,0.55)" rx="2"/>';
  const outline = favorite ? '#ffb84d' : '#05222b';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="${hull}" fill="${color}" stroke="${outline}" stroke-width="${favorite ? 3 : 2}"/>${bridge}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (handle) clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  };
}

// Icon cache so we don't rebuild the same SVG string thousands of times per tick.
const iconCache = new Map<string, string>();
function cachedIcon(color: string, favorite: boolean): string {
  const key = `${color}-${favorite}`;
  if (!iconCache.has(key)) iconCache.set(key, shipIconDataUri(color, favorite));
  return iconCache.get(key)!;
}

export function ShipLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.ships);
  const favoritesOnly = useLayersStore((s) => s.shipFavoritesOnly);
  const favorites = useLayersStore((s) => s.shipFavorites);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('ships');
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
      const lonSpan = east >= west ? east - west : east + 360 - west;
      let centerLon = west + lonSpan / 2;
      if (centerLon > 180) centerLon -= 360;

      const latHalfNm = ((north - south) / 2) * 60;
      const lonHalfNm = (lonSpan / 2) * 60 * Math.cos(Cesium.Math.toRadians(centerLat));
      const radiusNm = Math.ceil(Math.sqrt(latHalfNm ** 2 + lonHalfNm ** 2));

      if (!Number.isFinite(radiusNm) || radiusNm > MAX_RADIUS_NM) {
        ds.entities.removeAll();
        useShipsStatus.getState().setStatus({ tooWideView: true, count: 0, error: null });
        viewer.scene.requestRender();
        return;
      }

      try {
        const data = await api.ships(centerLat, centerLon, Math.max(1, radiusNm));
        if (cancelled) return;

        if (data.source === 'no-key') {
          useShipsStatus.getState().setStatus({ noKey: true, count: 0, error: null });
          return;
        }

        ds.entities.removeAll();

        const visible = favoritesOnly
          ? data.ships.filter((s) => favorites.includes(s.mmsi))
          : data.ships;

        for (const ship of visible) {
          const isFavorite = favorites.includes(ship.mmsi);
          const color = shipColor(ship.shipType);
          // Prefer TrueHeading; fall back to COG so the icon always has some orientation.
          const bearing = ship.heading ?? ship.course ?? 0;

          const entity = ds.entities.add({
            id: `ship-${ship.mmsi}`,
            position: Cesium.Cartesian3.fromDegrees(ship.longitude, ship.latitude, 0),
            billboard: {
              image: cachedIcon(color, isFavorite),
              width: isFavorite ? 28 : 22,
              height: isFavorite ? 28 : 22,
              rotation: Cesium.Math.toRadians(-bearing),
              alignedAxis: Cesium.Cartesian3.UNIT_Z,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });

          attachPanelData(entity, {
            id: `ship-${ship.mmsi}`,
            kind: 'ships',
            title: ship.name?.trim() || `MMSI ${ship.mmsi}`,
            subtitle: [shipTypeLabel(ship.shipType), ship.callsign].filter(Boolean).join(' · '),
            payload: { ...ship },
          });
        }

        useShipsStatus.getState().setStatus({
          tooWideView: false,
          count: visible.length,
          error: null,
          noKey: false,
          connected: data.connected ?? true,
        });
        viewer.scene.requestRender();
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load ships', err);
        useShipsStatus.getState().setStatus({ error: 'AIS feed unavailable' });
      }
    };

    load();
    const debouncedLoad = debounce(load, 800);
    viewer.camera.moveEnd.addEventListener(debouncedLoad);
    const interval = setInterval(load, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      viewer.camera.moveEnd.removeEventListener(debouncedLoad);
    };
  }, [viewer, active, favoritesOnly, favorites]);

  return null;
}

export function shipTypeLabel(type: number | null): string {
  if (type === null) return 'Unknown';
  if (type >= 70 && type <= 79) return 'Cargo';
  if (type >= 80 && type <= 89) return 'Tanker';
  if (type >= 60 && type <= 69) return 'Passenger';
  if (type === 30) return 'Fishing';
  if (type === 36 || type === 37) return 'Sailing';
  if (type === 31 || type === 32) return 'Towing';
  if (type === 52) return 'Tug';
  if (type === 55) return 'Law Enforcement';
  if (type >= 50 && type <= 59) return 'Special';
  if (type >= 40 && type <= 49) return 'High Speed';
  if (type >= 20 && type <= 29) return 'Wing in Ground';
  return 'Other';
}
