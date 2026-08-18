import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { startVisiblePolling } from '../../lib/poll';
import type { ShipState } from '../../types';
import { useShipsStatus } from './shipsStore';
import {
  SHIP_MARKER,
  pingAlpha,
  pingScale,
  prefersReducedMotion,
  shipHullUri,
  shipNameLabel,
  shipPingUri,
  shipReticleUri,
} from './shipMarkers';

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

// Every billboard stacked on a ship — hull, furniture and rings — opens the same
// panel, so the whole marker footprint is one click target.
function shipPanelData(ship: ShipState) {
  return {
    id: `ship-${ship.mmsi}`,
    kind: 'ships' as const,
    title: ship.name?.trim() || `MMSI ${ship.mmsi}`,
    subtitle: [shipTypeLabel(ship.shipType), ship.callsign].filter(Boolean).join(' · '),
    payload: { ...ship },
  };
}

// How far ahead to project the dead-reckoning "future path".
const FUTURE_HOURS = 6;

// Sub-metre altitude lifts that break the depth tie between the billboards
// stacked on a ship's position, so the hull always draws over its own reticle
// and rings. Far too small to see at any real viewing distance.
const ALT_PING = 0;
const ALT_RETICLE = 1;
const ALT_HULL = 2;

// Render pacing for the ping. The globe runs in requestRenderMode, so an
// animated CallbackProperty only advances when something asks for a frame —
// this layer pumps its own while at least one ship is on screen. A ring takes
// seconds to expand, so ~22fps is indistinguishable from full rate and costs
// a third of the frames.
const PING_FRAME_MS = 45;

// Fade ships sitting at a stale last-known position so it's clear they aren't
// reporting live (e.g. out of coastal AIS range).
function shipAlpha(lastSeenSec: number): number {
  const ageMin = lastSeenSec / 60;
  return ageMin < 20 ? 1 : ageMin < 120 ? 0.6 : 0.4;
}

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
  const showNames = useLayersStore((s) => s.shipNames);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const lastSigRef = useRef<string>('');

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
      lastSigRef.current = '';
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;

    // --- Ping render pump ----------------------------------------------------
    // The ring billboards read their own scale/alpha off the clock; this loop
    // only asks Cesium for frames, and idles the moment no marker is on screen —
    // so a fleet parked on the far side of the globe costs nothing.
    let pingRaf: number | null = null;
    let lastPingFrame = 0;
    let shipPositions: Array<{ lon: number; lat: number }> = [];
    let viewRect: Cesium.Rectangle | null = null;
    const scratchCarto = new Cesium.Cartographic();

    const anyShipInView = (): boolean => {
      if (!shipPositions.length) return false;
      if (!viewRect) return true; // can't tell — keep animating
      return shipPositions.some(({ lon, lat }) => {
        Cesium.Cartographic.fromDegrees(lon, lat, 0, scratchCarto);
        return Cesium.Rectangle.contains(viewRect!, scratchCarto);
      });
    };

    const pingFrame = () => {
      if (cancelled) {
        pingRaf = null;
        return;
      }
      if (!anyShipInView()) {
        pingRaf = null;
        return;
      }
      const now = performance.now();
      if (now - lastPingFrame >= PING_FRAME_MS) {
        lastPingFrame = now;
        viewer.scene.requestRender();
      }
      pingRaf = requestAnimationFrame(pingFrame);
    };

    const ensurePing = () => {
      if (prefersReducedMotion()) return; // rings are frozen — no frames needed
      if (pingRaf == null && anyShipInView()) pingRaf = requestAnimationFrame(pingFrame);
    };

    viewRect = viewer.camera.computeViewRectangle() ?? null;
    const offCamera = viewer.camera.changed.addEventListener(() => {
      viewRect = viewer.camera.computeViewRectangle() ?? null;
      ensurePing();
    });

    const load = async () => {
      try {
        const data = await api.ships();
        if (cancelled) return;

        if (data.source === 'no-key') {
          useShipsStatus.getState().setStatus({ noKey: true, count: 0, error: null });
          return;
        }

        // Publish the full fleet (pre-filter) so the sidebar roster can fly to
        // any ship regardless of the favorites-only globe filter.
        useShipsStatus.getState().setShips(data.ships);

        const visible = favoritesOnly
          ? data.ships.filter((s) => favorites.includes(s.mmsi))
          : data.ships;

        const setStatus = () =>
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

        // Skip the teardown/redraw when nothing that affects rendering changed.
        // Name is included because it can arrive late (AIS static data) while
        // the ship itself sits still — the nametag must update anyway.
        const sig =
          `${showPaths}|${showNames}|${favoritesOnly}|${favorites.join(',')}|` +
          visible
            .map(
              (s) =>
                `${s.mmsi}:${s.latitude}:${s.longitude}:${s.heading}:${s.course}:${shipAlpha(s.lastSeenSec)}:${s.name ?? ''}`
            )
            .join('|');
        if (sig === lastSigRef.current) {
          setStatus();
          ensurePing();
          return;
        }
        lastSigRef.current = sig;

        ds.entities.removeAll();
        shipPositions = visible.map((s) => ({ lon: s.longitude, lat: s.latitude }));

        for (const ship of visible) {
          const isFavorite = favorites.includes(ship.mmsi);
          const color = shipColor(ship.shipType);
          const bearing = ship.heading ?? ship.course ?? 0;

          const alpha = shipAlpha(ship.lastSeenSec);
          const tint = Cesium.Color.WHITE.withAlpha(alpha);
          const position = Cesium.Cartesian3.fromDegrees(ship.longitude, ship.latitude, ALT_PING);

          // Rings first: they expand out from under the marker and must not
          // cover it, so they sit lowest in the stack.
          const pingImage = shipPingUri(color);
          for (let i = 0; i < SHIP_MARKER.ping.count; i++) {
            const ring = i;
            const ringEntity = ds.entities.add({
              id: `ship-${ship.mmsi}-ping-${i}`,
              position,
              billboard: {
                image: pingImage,
                width: SHIP_MARKER.ping.sizePx,
                height: SHIP_MARKER.ping.sizePx,
                scale: new Cesium.CallbackProperty(() => pingScale(ring), false),
                color: new Cesium.CallbackProperty(
                  () => Cesium.Color.WHITE.withAlpha(pingAlpha(ring, alpha)),
                  false
                ),
                scaleByDistance: SHIP_MARKER.scaleByDistance,
                // Default depth test so far-side rings stay hidden behind the globe.
              },
            });
            // The rings are the marker's outer edge — clicking one should open
            // the ship, not fall through to whatever is underneath.
            attachPanelData(ringEntity, shipPanelData(ship));
          }

          const reticle = ds.entities.add({
            id: `ship-${ship.mmsi}-reticle`,
            position: Cesium.Cartesian3.fromDegrees(ship.longitude, ship.latitude, ALT_RETICLE),
            billboard: {
              image: shipReticleUri(color, isFavorite),
              width: SHIP_MARKER.reticlePx,
              height: SHIP_MARKER.reticlePx,
              color: tint,
              scaleByDistance: SHIP_MARKER.scaleByDistance,
              // Deliberately not rotated: the reticle stays a stable target
              // while the hull turns inside it.
            },
          });
          attachPanelData(reticle, shipPanelData(ship));

          const hullSize = isFavorite ? SHIP_MARKER.favoriteHullPx : SHIP_MARKER.hullPx;
          const entity = ds.entities.add({
            id: `ship-${ship.mmsi}`,
            position: Cesium.Cartesian3.fromDegrees(ship.longitude, ship.latitude, ALT_HULL),
            billboard: {
              image: shipHullUri(color, isFavorite),
              width: hullSize,
              height: hullSize,
              rotation: Cesium.Math.toRadians(-bearing),
              alignedAxis: Cesium.Cartesian3.UNIT_Z,
              color: tint,
              scaleByDistance: SHIP_MARKER.scaleByDistance,
              // Default depth test so ships on the far side of the globe stay hidden.
            },
            label: showNames
              ? shipNameLabel(ship.name?.trim() || `MMSI ${ship.mmsi}`, color, alpha)
              : undefined,
          });

          attachPanelData(entity, shipPanelData(ship));

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

        setStatus();
        ensurePing();
        viewer.scene.requestRender();
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load ships', err);
        useShipsStatus.getState().setStatus({ error: 'AIS feed unavailable' });
      }
    };

    const stopPolling = startVisiblePolling(() => void load(), 30_000);

    return () => {
      cancelled = true;
      stopPolling();
      offCamera();
      if (pingRaf != null) cancelAnimationFrame(pingRaf);
    };
  }, [viewer, active, favoritesOnly, favorites, showPaths, showNames]);

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
