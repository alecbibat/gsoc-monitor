import * as Cesium from 'cesium';
import { useCallback, useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { api } from '../../api/client';
import { useAqiStatus } from './aqiStore';
import type { AqiResponse } from '../../types';

// Official EPA / AirNow AQI color scale — the standard AirNow legend, keyed by
// category number (1–6).
const CATEGORY_COLOR: Record<number, string> = {
  1: '#00e400', // Good
  2: '#ffff00', // Moderate
  3: '#ff7e00', // Unhealthy for Sensitive Groups
  4: '#ff0000', // Unhealthy
  5: '#8f3f97', // Very Unhealthy
  6: '#7e0023', // Hazardous
};

// Text color: dark text on light backgrounds (Good/Moderate), white elsewhere.
const TEXT_COLOR: Record<number, string> = {
  1: '#003300',
  2: '#555500',
  3: '#ffffff',
  4: '#ffffff',
  5: '#ffffff',
  6: '#ffffff',
};

// Map an AQI value to its EPA/AirNow category number (1–6) via the official
// breakpoints. Driving the dot color and size off the AQI value itself — rather
// than the feed's Category.Number, which can be absent or "Unavailable" (7) and
// would otherwise fall back to a gray dot — guarantees every dot's color matches
// both the number it shows and the AirNow chart.
function aqiCategory(aqi: number): number {
  if (!Number.isFinite(aqi) || aqi <= 50) return 1; // Good
  if (aqi <= 100) return 2; // Moderate
  if (aqi <= 150) return 3; // Unhealthy for Sensitive Groups
  if (aqi <= 200) return 4; // Unhealthy
  if (aqi <= 300) return 5; // Very Unhealthy
  return 6; // Hazardous
}

// --- AirNow numbered badge (authoritative reference monitors) ----------------
function makeAqiSvg(aqi: number): string {
  const cat = aqiCategory(aqi);
  const fill = CATEGORY_COLOR[cat];
  const text = TEXT_COLOR[cat];
  const fontSize = aqi >= 100 ? 10 : 12;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<circle cx="16" cy="16" r="14" fill="${fill}" stroke="#0a0e1a" stroke-width="2"/>` +
    `<text x="16" y="${16 + fontSize / 3}" text-anchor="middle" ` +
    `font-family="system-ui,sans-serif" font-size="${fontSize}" font-weight="bold" fill="${text}">${aqi}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const iconCache = new Map<number, string>();
function aqiIcon(aqi: number): string {
  if (!iconCache.has(aqi)) iconCache.set(aqi, makeAqiSvg(aqi));
  return iconCache.get(aqi)!;
}

// Billboard size: 22px for Good, growing 3px per category up to 34px for
// Hazardous, so worse air both reads redder and looms larger.
function iconSize(aqi: number): number {
  return 22 + (aqiCategory(aqi) - 1) * 3;
}

// --- PurpleAir dot (dense low-cost sensor field) -----------------------------
// A small colored dot, no number — there are thousands, so the number would be
// noise. The size/number difference makes the two sources distinguishable at a
// glance: numbered badges = official AirNow, plain dots = PurpleAir.
const paIconCache = new Map<number, string>();
function paDotIcon(cat: number): string {
  if (!paIconCache.has(cat)) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">` +
      `<circle cx="10" cy="10" r="6.5" fill="${CATEGORY_COLOR[cat]}" stroke="#0a0e1a" stroke-width="1.5"/>` +
      `</svg>`;
    paIconCache.set(cat, `data:image/svg+xml,${encodeURIComponent(svg)}`);
  }
  return paIconCache.get(cat)!;
}
function paSize(cat: number): number {
  return 12 + (cat - 1) * 1.5; // 12–19.5px, smaller than the AirNow badges
}

export function AqiLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.aqi);
  const showAirnow = useAqiStatus((s) => s.showAirnow);
  const showPurpleair = useAqiStatus((s) => s.showPurpleair);

  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const dataRef = useRef<AqiResponse | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('aqi');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  // Render the last-fetched stations honoring the per-source visibility toggles.
  // Kept separate from the fetch so flipping a source on/off re-renders instantly
  // without a network round-trip.
  const render = useCallback(() => {
    const ds = dsRef.current;
    if (!viewer || !ds) return;
    ds.entities.removeAll();
    if (!active) {
      viewer.scene.requestRender();
      return;
    }
    const data = dataRef.current;
    if (!data) {
      viewer.scene.requestRender();
      return;
    }

    // Draw PurpleAir first so the larger AirNow badges layer on top where they
    // overlap.
    const ordered = [...data.stations].sort(
      (a, b) => (a.source === 'purpleair' ? 0 : 1) - (b.source === 'purpleair' ? 0 : 1)
    );

    let worstAqi = 0;
    let worstCategory = '';
    let visible = 0;

    for (const s of ordered) {
      if (s.source === 'airnow' && !showAirnow) continue;
      if (s.source === 'purpleair' && !showPurpleair) continue;
      if (!Number.isFinite(s.lon) || !Number.isFinite(s.lat)) continue;
      if (s.lat < -90 || s.lat > 90 || s.lon < -180 || s.lon > 180) continue;

      const isPa = s.source === 'purpleair';
      const cat = aqiCategory(s.aqi);
      const sz = isPa ? paSize(cat) : iconSize(s.aqi);
      const entity = ds.entities.add({
        id: s.id,
        position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 0),
        billboard: {
          image: isPa ? paDotIcon(cat) : aqiIcon(s.aqi),
          width: sz,
          height: sz,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          // Fade out at globe scale so the map isn't a wall of dots.
          scaleByDistance: new Cesium.NearFarScalar(1.0e5, 1.0, 6.0e6, 0.3),
        },
      });
      attachPanelData(entity, {
        id: s.id,
        kind: 'aqi',
        title: s.reportingArea,
        subtitle: `AQI ${s.aqi} · ${s.categoryName}${isPa ? ' · PurpleAir' : ''}`,
        payload: s as unknown as Record<string, unknown>,
      });

      visible++;
      if (s.aqi > worstAqi) {
        worstAqi = s.aqi;
        worstCategory = s.categoryName;
      }
    }

    useAqiStatus.getState().setStatus({
      count: visible,
      worstAqi,
      worstCategory,
      airnowCount: data.counts?.airnow ?? 0,
      purpleairCount: data.counts?.purpleair ?? 0,
      noKey: !!data.noKey,
      purpleAirNoKey: !!data.purpleAirNoKey,
      error: null,
    });
    viewer.scene.requestRender();
  }, [viewer, active, showAirnow, showPurpleair]);

  // Always call the latest render from the fetch loop without making the fetch
  // effect depend on the visibility toggles.
  const renderRef = useRef(render);
  renderRef.current = render;

  // Fetch + poll.
  useEffect(() => {
    if (!viewer) return;
    if (!active) {
      const ds = dsRef.current;
      if (ds) ds.entities.removeAll();
      useAqiStatus.getState().setStatus({ count: 0, worstAqi: 0, worstCategory: '' });
      viewer.scene.requestRender();
      return;
    }
    let cancelled = false;
    const load = async () => {
      let data: AqiResponse;
      try {
        data = await api.aqi();
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load AQI data', err);
        useAqiStatus.getState().setStatus({ error: 'Air quality feed unavailable' });
        return;
      }
      if (cancelled) return;
      dataRef.current = data;
      renderRef.current();
    };
    load();
    // AirNow is hourly, PurpleAir ~real-time; 15 min keeps the dense field fresh.
    const interval = setInterval(load, 15 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [viewer, active]);

  // Re-render (no refetch) when a source is toggled on/off.
  useEffect(() => {
    renderRef.current();
  }, [showAirnow, showPurpleair]);

  return null;
}
