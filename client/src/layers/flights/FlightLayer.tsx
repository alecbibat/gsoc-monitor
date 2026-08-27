import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { startVisiblePolling } from '../../lib/poll';
import type { FlightState, FlightTrackPoint } from '../../types';
import { useFlightsStatus } from './flightsStore';
import { SHIP_MARKER, shipNameLabel, shipReticleUri } from '../ships/shipMarkers';
import { createPingPump, pingBillboard } from '../ships/shipPing';
import {
  FLIGHT_GROUND_COLOR,
  FLIGHT_MARKER,
  LIVE_WINDOW_SEC,
  TRAIL_LIGHT,
  TRAIL_SAT,
  aircraftTypeText,
  altitudeHue,
  chevronIconUri,
  chevronPlacements,
  flightAlpha,
  flightMarkerColor,
  lastSeenText,
  planeIconUri,
  resolveTrailAltitudes,
  splitTrail,
} from './flightMarkers';

// Cesium colour for a trail vertex — flightMarkers stays Cesium-free so its
// palette math is unit-testable.
const GROUND_CESIUM_COLOR = Cesium.Color.fromCssColorString(FLIGHT_GROUND_COLOR);
function altitudeCesiumColor(altFt: number | null, ground: boolean, alpha: number): Cesium.Color {
  if (ground || altFt == null) return GROUND_CESIUM_COLOR.withAlpha(alpha);
  return Cesium.Color.fromHsl(altitudeHue(altFt) / 360, TRAIL_SAT, TRAIL_LIGHT, alpha);
}

// Every billboard stacked on an aircraft — silhouette, reticle and rings —
// opens the same panel, so the whole marker footprint is one click target.
function flightPanelData(flight: FlightState, grounded: boolean) {
  return {
    id: `flight-${flight.icao24}`,
    kind: 'flights' as const,
    title: flight.registration ?? flight.callsign?.trim() ?? flight.icao24.toUpperCase(),
    subtitle: [
      aircraftTypeText(flight.aircraftInfo, flight.type),
      grounded ? 'On ground' : 'Airborne',
      lastSeenText(flight.lastSeenSec),
    ]
      .filter(Boolean)
      .join(' · '),
    payload: { ...flight },
  };
}

// Sub-metre altitude lifts that break the depth tie between the billboards
// stacked on an aircraft's position, so the silhouette always draws over its
// own reticle and rings (same trick as the ship marker).
const ALT_PING = 0;
const ALT_RETICLE = 1;
const ALT_ICON = 2;

const FT_TO_M = 0.3048;

export function FlightLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.flights);
  const favorites = useLayersStore((s) => s.flightFavorites);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const trailsRef = useRef<Cesium.PrimitiveCollection | null>(null);
  const chevronsRef = useRef<Cesium.BillboardCollection | null>(null);
  const lastSigRef = useRef<string>('');

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('flights');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    // Trails are per-vertex-coloured polylines, which entities can't express —
    // they live in a primitive collection managed alongside the data source.
    const trails = new Cesium.PrimitiveCollection();
    trailsRef.current = trails;
    viewer.scene.primitives.add(trails);
    // Direction chevrons along the trails — plain billboards, not clickable,
    // so a raw collection is cheaper than entities.
    const chevrons = new Cesium.BillboardCollection();
    chevronsRef.current = chevrons;
    viewer.scene.primitives.add(chevrons);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
      viewer.scene.primitives.remove(trails);
      trailsRef.current = null;
      viewer.scene.primitives.remove(chevrons);
      chevronsRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    const ds = dsRef.current;
    const trails = trailsRef.current;
    const chevrons = chevronsRef.current;
    if (!viewer || !ds || !trails || !chevrons) return;

    if (!active) {
      ds.entities.removeAll();
      trails.removeAll();
      chevrons.removeAll();
      lastSigRef.current = '';
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;

    // Ping frame pump — the same shared-clock animation as the ship layer, so
    // ships and planes pulse in step.
    const pump = createPingPump(viewer);
    const ensurePing = () => pump.ensure();

    const load = async () => {
      try {
        const data = await api.flightsByTail();
        if (cancelled) return;

        // Publish the full list (even when the redraw below is skipped) so an
        // open details panel tracks live state instead of its click snapshot.
        useFlightsStatus.getState().setFlights(data.flights);

        const setStatus = () =>
          useFlightsStatus.getState().setStatus({
            tooWideView: false,
            count: data.flights.length,
            error: null,
          });

        // Skip the teardown/redraw when nothing that affects rendering changed.
        // The marker colour tracks altitude and the trail grows a point at a
        // time, so both participate — and the sig must derive `grounded`
        // exactly as the render below does, or the live→stale flip of a
        // transponder that went dark (nothing else changing) would never
        // trigger the redraw that clamps and greys the marker.
        const sig =
          `${favorites.join(',')}|` +
          data.flights
            .map((f) => {
              const grounded = f.onGround || f.lastSeenSec >= LIVE_WINDOW_SEC;
              const trail = f.trail ?? [];
              const lastPt = trail[trail.length - 1];
              return (
                `${f.icao24}:${f.latitude}:${f.longitude}:${f.track}:${grounded}:` +
                `${flightAlpha(f.lastSeenSec, f.onGround)}:` +
                `${flightMarkerColor(f.altitudeFt, grounded)}:${trail.length}:${lastPt?.t ?? 0}:` +
                // The registry lookup can land minutes after the aircraft is
                // first drawn, and the nametag's type line must pick it up.
                `${aircraftTypeText(f.aircraftInfo, f.type) ?? ''}`
              );
            })
            .join('|');
        if (sig === lastSigRef.current) {
          // The drawn marker is unchanged, but the panel stamped on it ages —
          // without a re-stamp, clicking a jet parked overnight would open a
          // panel frozen at "last seen 3m ago". Refresh the stamp in place.
          for (const flight of data.flights) {
            const grounded = flight.onGround || flight.lastSeenSec >= LIVE_WINDOW_SEC;
            const panelData = flightPanelData(flight, grounded);
            const suffixes = [
              '',
              '-reticle',
              ...Array.from({ length: SHIP_MARKER.ping.count }, (_, i) => `-ping-${i}`),
            ];
            for (const suffix of suffixes) {
              const e = ds.entities.getById(`flight-${flight.icao24}${suffix}`);
              if (e) attachPanelData(e, panelData);
            }
          }
          setStatus();
          ensurePing();
          return;
        }
        lastSigRef.current = sig;

        ds.entities.removeAll();
        trails.removeAll();
        chevrons.removeAll();
        pump.setPositions(
          data.flights
            .filter((f) => f.longitude != null && f.latitude != null)
            .map((f) => ({ lon: f.longitude as number, lat: f.latitude as number }))
        );

        const trailInstances: Cesium.GeometryInstance[] = [];

        for (const flight of data.flights) {
          if (flight.longitude == null || flight.latitude == null) continue;

          const stale = flight.lastSeenSec >= LIVE_WINDOW_SEC;
          const grounded = flight.onGround || stale;
          // Airborne: draw at true altitude. Grounded/parked: clamp to surface.
          const baseAlt = grounded ? 0 : (flight.altitudeFt ?? 0) * FT_TO_M;
          const alpha = flightAlpha(flight.lastSeenSec, flight.onGround);
          const tint = Cesium.Color.WHITE.withAlpha(alpha);
          const color = flightMarkerColor(flight.altitudeFt, grounded);
          const isFavorite = favorites.includes(flight.icao24);
          const panelData = flightPanelData(flight, grounded);
          const at = (lift: number) =>
            Cesium.Cartesian3.fromDegrees(flight.longitude!, flight.latitude!, baseAlt + lift);

          // Rings first: they expand out from under the marker and must not
          // cover it, so they sit lowest in the stack.
          for (let i = 0; i < SHIP_MARKER.ping.count; i++) {
            const ringEntity = ds.entities.add({
              id: `flight-${flight.icao24}-ping-${i}`,
              position: at(ALT_PING),
              billboard: pingBillboard(color, i, alpha),
            });
            attachPanelData(ringEntity, panelData);
          }

          const reticle = ds.entities.add({
            id: `flight-${flight.icao24}-reticle`,
            position: at(ALT_RETICLE),
            billboard: {
              image: shipReticleUri(color, isFavorite),
              width: SHIP_MARKER.reticlePx,
              height: SHIP_MARKER.reticlePx,
              color: tint,
              scaleByDistance: SHIP_MARKER.scaleByDistance,
              // Deliberately not rotated: the reticle stays a stable target
              // while the plane turns inside it.
            },
          });
          attachPanelData(reticle, panelData);

          const iconSize = isFavorite ? FLIGHT_MARKER.favoriteIconPx : FLIGHT_MARKER.iconPx;
          const entity = ds.entities.add({
            id: `flight-${flight.icao24}`,
            position: at(ALT_ICON),
            billboard: {
              image: planeIconUri(color),
              width: iconSize,
              height: iconSize,
              rotation: Cesium.Math.toRadians(-(flight.track ?? 0)),
              alignedAxis: Cesium.Cartesian3.UNIT_Z,
              color: tint,
              scaleByDistance: SHIP_MARKER.scaleByDistance,
              // Default depth test — aircraft on the far side of the planet are
              // occluded by the globe (same pattern as the satellite layer).
            },
            // Two-line nametag: registration on top, airframe type beneath it
            // (Cesium labels render \n as a line break on the shared plate).
            label: shipNameLabel(
              [
                flight.registration ?? flight.callsign?.trim() ?? flight.icao24.toUpperCase(),
                aircraftTypeText(flight.aircraftInfo, flight.type),
              ]
                .filter(Boolean)
                .join('\n'),
              color,
              alpha
            ),
          });
          attachPanelData(entity, panelData);

          // Altitude rainbow trail — every breadcrumb coloured by the altitude
          // it was flown at. A live aircraft's trail is capped with its current
          // position so it reaches the plane; a stale one's is not — its marker
          // is a synthetic surface position, and connecting the trail to it
          // would draw a fake descent to the ground where coverage was lost.
          const pts: FlightTrackPoint[] = [...(flight.trail ?? [])];
          if (!stale) {
            pts.push({
              lat: flight.latitude,
              lon: flight.longitude,
              altFt: flight.altitudeFt,
              ground: flight.onGround,
              t: Date.now(),
            });
          }
          const trailAlpha = FLIGHT_MARKER.trail.alpha * alpha;
          const resolved = resolveTrailAltitudes(pts);
          // Comet taper: alpha ramps from faint at the oldest fix to full at
          // the newest, so the bright end always leads in the direction of
          // travel. Chevrons along the trail make the direction explicit.
          const t0 = resolved[0]?.t ?? 0;
          const tN = resolved[resolved.length - 1]?.t ?? 0;
          const taper = (t: number) =>
            tN > t0
              ? FLIGHT_MARKER.trail.taperFrom +
                (1 - FLIGHT_MARKER.trail.taperFrom) * ((t - t0) / (tN - t0))
              : 1;
          for (const seg of splitTrail(resolved)) {
            trailInstances.push(
              new Cesium.GeometryInstance({
                geometry: new Cesium.PolylineGeometry({
                  positions: seg.map((p) =>
                    Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.ground ? 0 : (p.altFt ?? 0) * FT_TO_M)
                  ),
                  width: FLIGHT_MARKER.trail.widthPx,
                  colors: seg.map((p) =>
                    altitudeCesiumColor(p.altFt, p.ground, trailAlpha * taper(p.t))
                  ),
                  colorsPerVertex: true,
                  vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
                }),
              })
            );
            for (const c of chevronPlacements(seg)) {
              chevrons.add({
                image: chevronIconUri(flightMarkerColor(c.altFt, c.ground)),
                position: Cesium.Cartesian3.fromDegrees(
                  c.lon,
                  c.lat,
                  c.ground ? 0 : (c.altFt ?? 0) * FT_TO_M
                ),
                width: FLIGHT_MARKER.trail.chevronPx,
                height: FLIGHT_MARKER.trail.chevronPx,
                rotation: Cesium.Math.toRadians(-c.bearingDeg),
                alignedAxis: Cesium.Cartesian3.UNIT_Z,
                color: Cesium.Color.WHITE.withAlpha(trailAlpha * taper(c.t)),
                scaleByDistance: SHIP_MARKER.scaleByDistance,
              });
            }
          }
        }

        if (trailInstances.length > 0) {
          trails.add(
            new Cesium.Primitive({
              geometryInstances: trailInstances,
              appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
              asynchronous: false,
              allowPicking: false,
            })
          );
        }

        setStatus();
        ensurePing();
        viewer.scene.requestRender();
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load flights', err);
        useFlightsStatus.getState().setStatus({ error: 'Live flight feed unavailable' });
      }
    };

    const stopPolling = startVisiblePolling(() => void load(), 10_000);

    return () => {
      cancelled = true;
      stopPolling();
      pump.dispose();
    };
  }, [viewer, active, favorites]);

  return null;
}
