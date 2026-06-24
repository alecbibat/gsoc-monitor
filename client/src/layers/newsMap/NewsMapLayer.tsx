import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { api } from '../../api/client';
import { haversineMeters, MILES_TO_M } from '../../lib/geo';
import { LOCATION_GROUPS } from '../locations/locations';
import { useNewsMapStore } from './newsMapStore';
import type { NewsMapEvent } from '../../types';

// Static pin coordinates to measure "near pins" against — the property/park/
// office locations. Mirrors how the fires layer scopes to pins.
const PIN_COORDS: Array<{ lat: number; lon: number }> = LOCATION_GROUPS.flatMap((g) =>
  g.locations.map((l) => ({ lat: l.lat, lon: l.lon })),
);

function nearestPinMeters(lat: number, lon: number): number {
  let best = Infinity;
  for (const p of PIN_COORDS) {
    const d = haversineMeters(lat, lon, p.lat, p.lon);
    if (d < best) best = d;
  }
  return best;
}

// A folded-newspaper glyph on a rounded pin. Tinted red when coverage skews
// notably negative (tone) so trouble spots read at a glance, indigo otherwise.
function newspaperIcon(fill: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="22" fill="${fill}" stroke="#0a0e1a" stroke-width="3"/>` +
    `<rect x="20" y="21" width="22" height="22" rx="2" fill="#0a0e1a"/>` +
    `<rect x="23" y="24" width="10" height="6" rx="1" fill="${fill}"/>` +
    `<rect x="35" y="24" width="4" height="2" rx="1" fill="${fill}"/>` +
    `<rect x="35" y="28" width="4" height="2" rx="1" fill="${fill}"/>` +
    `<rect x="23" y="33" width="16" height="2" rx="1" fill="${fill}"/>` +
    `<rect x="23" y="37" width="16" height="2" rx="1" fill="${fill}"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const ICON_NEUTRAL = newspaperIcon('#818cf8'); // indigo
const ICON_NEGATIVE = newspaperIcon('#f87171'); // red — markedly negative tone
const NEGATIVE_TONE = -5; // GDELT tone runs ~-10..+10; news skews mildly negative

function iconFor(tone: number | null): string {
  return tone != null && tone <= NEGATIVE_TONE ? ICON_NEGATIVE : ICON_NEUTRAL;
}

function iconSize(count: number): number {
  if (count >= 25) return 30;
  if (count >= 8) return 26;
  return 22;
}

export function NewsMapLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.newsMap);
  const nearMiles = useLayersStore((s) => s.newsNearMiles);
  // Re-render entities whenever the fetched set changes.
  const events = useNewsMapStore((s) => s.events);
  const updated = useNewsMapStore((s) => s.updated);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  // Create / destroy the data source.
  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('newsMap');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  // Fetch + poll. Writes raw events into the store; the render effect below
  // turns them into entities. Kept separate so flipping the scope re-filters
  // instantly without another GDELT round-trip.
  useEffect(() => {
    if (!viewer || !active) {
      if (!active) useNewsMapStore.getState().setEvents([], null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const data = await api.newsMap();
        if (cancelled) return;
        useNewsMapStore.getState().setEvents(data.events, data.updated);
        useNewsMapStore.getState().setStatus({ error: data.error ?? null });
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load GDELT news map', err);
        useNewsMapStore.getState().setStatus({ error: 'News feed unavailable' });
      }
    };

    load();
    const interval = setInterval(load, 10 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [viewer, active]);

  // Render: (re)build entities from the current events + scope. Runs on fetch
  // and whenever the near-pins radius changes.
  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds) return;

    if (!active) {
      ds.entities.removeAll();
      viewer.scene.requestRender();
      return;
    }

    const radiusM = nearMiles > 0 ? nearMiles * MILES_TO_M : Infinity;
    const shown: NewsMapEvent[] =
      radiusM === Infinity
        ? events
        : events.filter((e) => nearestPinMeters(e.lat, e.lon) <= radiusM);

    ds.entities.removeAll();
    for (const e of shown) {
      const sz = iconSize(e.count);
      const entity = ds.entities.add({
        id: `news-${e.id}`,
        position: Cesium.Cartesian3.fromDegrees(e.lon, e.lat, 0),
        billboard: {
          image: iconFor(e.tone),
          width: sz,
          height: sz,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          // Fade in once moderately zoomed so the globe view isn't cluttered.
          scaleByDistance: new Cesium.NearFarScalar(3.0e5, 1.0, 8.0e6, 0.4),
        },
      });
      attachPanelData(entity, {
        id: `news-${e.id}`,
        kind: 'newsMap',
        title: e.name,
        subtitle: `${e.count} article${e.count === 1 ? '' : 's'}`,
        payload: { ...e } as unknown as Record<string, unknown>,
      });
    }

    useNewsMapStore.getState().setStatus({ count: shown.length });
    viewer.scene.requestRender();
  }, [viewer, active, nearMiles, events, updated]);

  return null;
}
