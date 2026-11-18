import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { api } from '../../api/client';
import { startVisiblePolling } from '../../lib/poll';
import { useLayersStore } from '../../store/layersStore';
import { airportPanelData } from './airportPanel';
import { AIRPORT_TIERS, airportEvents, type AirportTier } from './airportsMeta';
import { NO_AIRPORT_TIERS, useAirportsStatus } from './airportsStore';

// ── FAA airport status ───────────────────────────────────────────────────────
// Every airport the FAA's Command Center reports something at — a ground stop,
// a ground delay program, a closure, arrival or departure delays, deicing — as
// nasstatus.faa.gov maps them. One marker per airport, coloured by the worst
// thing going on there; airports running normally aren't drawn. A closure that
// only applies at set hours counts as a closure only during them, so the
// colours are re-read every poll even when the FAA's list hasn't changed.
// Data: /api/faa/airports (server proxy).

const POLL_MS = 60_000;

/** Restrictions and deicing are background: smaller, and unnamed until zoomed in. */
const QUIET: ReadonlySet<AirportTier> = new Set(['notice', 'deicing']);

const iconCache = new Map<string, string>();
/** An aircraft, nose up, on a dark disc ringed in the tier's colour. */
function airportIcon(color: string): string {
  const hit = iconCache.get(color);
  if (hit) return hit;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="10.5" fill="#0a0c10" stroke="${color}" stroke-width="2"/>` +
    `<path fill="${color}" d="M12 4.2c.62 0 1.05.6 1.05 1.5v3.6l5.2 3.2v1.5l-5.2-1.6v3.1l1.5 1.1v1.2L12 17.1l-2.55.7v-1.2l1.5-1.1v-3.1l-5.2 1.6v-1.5l5.2-3.2V5.7c0-.9.43-1.5 1.05-1.5z"/>` +
    `</svg>`;
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  iconCache.set(color, url);
  return url;
}

export function AirportStatusLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.airports);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const lastSigRef = useRef('');

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('airports');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
      lastSigRef.current = '';
    };
  }, [viewer]);

  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds) return;
    if (!active) {
      ds.entities.removeAll();
      lastSigRef.current = '';
      useAirportsStatus.getState().setStatus({ count: 0, tiers: { ...NO_AIRPORT_TIERS }, error: null });
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;
    const load = async () => {
      let feed;
      try {
        feed = await api.faaAirports();
      } catch (err) {
        if (cancelled) return;
        console.warn('FAA airport status fetch failed', err);
        useAirportsStatus.getState().setStatus({ error: 'FAA airport status unavailable' });
        return;
      }
      if (cancelled) return;

      const now = Date.now();
      const rows = feed.airports
        .map((a) => ({ a, events: airportEvents(a, now) }))
        .filter((r) => r.events.length > 0);
      const tiers = { ...NO_AIRPORT_TIERS };
      for (const r of rows) tiers[r.events[0].tier]++;
      useAirportsStatus.getState().setStatus({ count: rows.length, tiers, fetchedAt: feed.fetchedAt, error: null });

      const sig = rows.map((r) => `${r.a.id}@${r.events.map((e) => `${e.kind}:${e.tier}:${e.detail ?? ''}`).join(',')}`).join('|');
      if (sig === lastSigRef.current) return;
      lastSigRef.current = sig;

      ds.entities.removeAll();
      ds.entities.suspendEvents();
      try {
        for (const { a, events } of rows) {
          const lead = events[0];
          const tier = AIRPORT_TIERS[lead.tier];
          const quiet = QUIET.has(lead.tier);
          const color = Cesium.Color.fromCssColorString(tier.color);
          const size = quiet ? 20 : 28;
          const panel = airportPanelData(a, now);
          const marker = ds.entities.add({
            id: `airport-${a.id}`,
            // Surface anchor + default depth test, so the globe hides far-side markers.
            position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 0),
            billboard: {
              image: airportIcon(tier.color),
              width: size,
              height: size,
              scaleByDistance: new Cesium.NearFarScalar(300_000, 1.15, 12_000_000, 0.8),
            },
            label: {
              text: a.id,
              font: `700 ${quiet ? 11 : 12}px Inter, system-ui, sans-serif`,
              fillColor: color,
              outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.TOP,
              pixelOffset: new Cesium.Cartesian2(0, size / 2 + 3),
              // Airports with a live program are named from the national view.
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, quiet ? 2_500_000 : 20_000_000),
            },
          });
          attachPanelData(marker, panel);
          // What is going on there, once zoomed in to a region.
          const more = events.length - 1;
          const caption = ds.entities.add({
            id: `airport-${a.id}-caption`,
            position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 0),
            label: {
              text: more > 0 ? `${lead.title} +${more}` : lead.title,
              font: '600 11px Inter, system-ui, sans-serif',
              fillColor: Cesium.Color.WHITE.withAlpha(0.85),
              outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.TOP,
              pixelOffset: new Cesium.Cartesian2(0, size / 2 + 18),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1_500_000),
            },
          });
          attachPanelData(caption, panel);
        }
      } finally {
        ds.entities.resumeEvents();
      }
      viewer.scene.requestRender();
    };

    const stop = startVisiblePolling(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [viewer, active]);

  return null;
}
