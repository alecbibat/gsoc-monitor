import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { useShipsStatus } from './shipsStore';

function shipColor(type: number | null): string {
  if (type === null) return '#8fc7d9';
  if (type >= 70 && type <= 79) return '#3ddcff'; // Cargo
  if (type >= 80 && type <= 89) return '#ff9d2e'; // Tanker
  if (type >= 60 && type <= 69) return '#4dff91'; // Passenger
  if (type === 30) return '#ffd84d';              // Fishing
  if (type === 36 || type === 37) return '#ffd84d'; // Sailing
  if (type >= 50 && type <= 59) return '#c084fc'; // Special
  if (type >= 40 && type <= 49) return '#ff5ad8'; // High Speed
  return '#8fc7d9';
}

function shipIconDataUri(color: string, favorite: boolean): string {
  const hull = 'M32 4 L46 20 L46 58 L18 58 L18 20 Z';
  const bridge = '<rect x="24" y="28" width="16" height="12" fill="rgba(5,34,43,0.55)" rx="2"/>';
  const outline = favorite ? '#ffb84d' : '#05222b';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="${hull}" fill="${color}" stroke="${outline}" stroke-width="${favorite ? 3 : 2}"/>${bridge}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const iconCache = new Map<string, string>();
function cachedIcon(color: string, favorite: boolean): string {
  const key = `${color}-${favorite}`;
  if (!iconCache.has(key)) iconCache.set(key, shipIconDataUri(color, favorite));
  return iconCache.get(key)!;
}

// How far ahead to project the dead-reckoning "future path".
const FUTURE_HOURS = 6;

// Great-circle point a given distance along a fixed initial bearing from a
// start point. Projecting at increasing distances traces the great circle, so
// this yields a smooth predicted-track arc.
function projectGreatCircle(
  lat: number,
  lon: number,
  bearingDeg: number,
  distM: number
): [number, number] {
  const R = 6_371_000;
  const d = distM / R;
  const th = (bearingDeg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const sinP2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th);
  const p2 = Math.asin(Math.max(-1, Math.min(1, sinP2)));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * sinP2);
  let lonDeg = (l2 * 180) / Math.PI;
  lonDeg = ((lonDeg + 540) % 360) - 180; // normalize to [-180, 180]
  return [lonDeg, (p2 * 180) / Math.PI];
}

export function ShipLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.ships);
  const favoritesOnly = useLayersStore((s) => s.shipFavoritesOnly);
  const favorites = useLayersStore((s) => s.shipFavorites);
  const showPaths = useLayersStore((s) => s.shipPaths);
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
      try {
        const data = await api.ships();
        if (cancelled) return;

        if (data.source === 'no-key') {
          useShipsStatus.getState().setStatus({ noKey: true, count: 0, error: null });
          return;
        }

        ds.entities.removeAll();

        // Publish the full fleet (pre-filter) so the sidebar roster can fly to
        // any ship regardless of the favorites-only globe filter.
        useShipsStatus.getState().setShips(data.ships);

        const visible = favoritesOnly
          ? data.ships.filter((s) => favorites.includes(s.mmsi))
          : data.ships;

        for (const ship of visible) {
          const isFavorite = favorites.includes(ship.mmsi);
          const color = shipColor(ship.shipType);
          const bearing = ship.heading ?? ship.course ?? 0;

          // Fade ships sitting at a stale last-known position so it's clear
          // they aren't reporting live (e.g. out of coastal AIS range).
          const ageMin = ship.lastSeenSec / 60;
          const alpha = ageMin < 20 ? 1 : ageMin < 120 ? 0.6 : 0.4;

          const entity = ds.entities.add({
            id: `ship-${ship.mmsi}`,
            position: Cesium.Cartesian3.fromDegrees(ship.longitude, ship.latitude, 0),
            billboard: {
              image: cachedIcon(color, isFavorite),
              width: isFavorite ? 28 : 22,
              height: isFavorite ? 28 : 22,
              rotation: Cesium.Math.toRadians(-bearing),
              alignedAxis: Cesium.Cartesian3.UNIT_Z,
              color: Cesium.Color.WHITE.withAlpha(alpha),
              // Default depth test so ships on the far side of the globe stay hidden.
            },
          });

          attachPanelData(entity, {
            id: `ship-${ship.mmsi}`,
            kind: 'ships',
            title: ship.name?.trim() || `MMSI ${ship.mmsi}`,
            subtitle: [shipTypeLabel(ship.shipType), ship.callsign].filter(Boolean).join(' · '),
            payload: { ...ship },
          });

          if (!showPaths) continue;
          const cesColor = Cesium.Color.fromCssColorString(color);

          // Past path — the breadcrumb trail of where the ship has been,
          // draped on the surface so ocean-crossing gaps follow the globe.
          const track = ship.track ?? [];
          if (track.length > 1) {
            const positions = track.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
            positions.push(Cesium.Cartesian3.fromDegrees(ship.longitude, ship.latitude));
            ds.entities.add({
              polyline: {
                positions,
                width: 2,
                clampToGround: true,
                material: cesColor.withAlpha(0.5),
              },
            });
          }

          // Future path — dead-reckoning projection along current course/speed.
          const travelBearing = ship.course ?? ship.heading;
          if (ship.speedKt != null && ship.speedKt > 0.5 && travelBearing != null) {
            const distM = ship.speedKt * 1852 * FUTURE_HOURS;
            const pts: Cesium.Cartesian3[] = [];
            for (let i = 0; i <= 16; i++) {
              const [lo, la] = projectGreatCircle(ship.latitude, ship.longitude, travelBearing, (distM * i) / 16);
              pts.push(Cesium.Cartesian3.fromDegrees(lo, la));
            }
            ds.entities.add({
              polyline: {
                positions: pts,
                width: 2,
                clampToGround: true,
                material: new Cesium.PolylineDashMaterialProperty({
                  color: cesColor.withAlpha(0.85),
                  dashLength: 14,
                }),
              },
            });
            // Predicted position marker at the end of the projection.
            ds.entities.add({
              position: pts[pts.length - 1],
              point: {
                pixelSize: 5,
                color: cesColor.withAlpha(0.7),
                outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
                outlineWidth: 1,
                // Default depth test so far-side markers stay hidden behind the globe.
              },
            });
          }
        }

        useShipsStatus.getState().setStatus({
          count: visible.length,
          total: data.total ?? 7,
          error: null,
          noKey: false,
          connected: data.connected ?? true,
          streaming: data.streaming ?? false,
          messages: data.messages ?? 0,
          matched: data.matched ?? 0,
        });
        viewer.scene.requestRender();
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load ships', err);
        useShipsStatus.getState().setStatus({ error: 'AIS feed unavailable' });
      }
    };

    load();
    const interval = setInterval(load, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [viewer, active, favoritesOnly, favorites, showPaths]);

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
