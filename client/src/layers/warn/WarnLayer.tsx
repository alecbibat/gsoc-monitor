import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { api } from '../../api/client';
import { circleRing } from '../../lib/geo';
import { startVisiblePolling } from '../../lib/poll';
import { useLayersStore } from '../../store/layersStore';
import { useScreensaverStore } from '../../screensaver/screensaverStore';
import type { WarnAlert } from '../../types';
import { WEA_CLASSES } from './warnMeta';
import { useWarnStatus } from './warnStore';

// ── PBS WARN: Wireless Emergency Alerts ──────────────────────────────────────
// Every WEA in force — the alerts sent to phones in an area, from the NWS and
// USGS but also state and local agencies (AMBER alerts, evacuations, police
// activity, 911 outages) — as PBS WARN broadcasts and maps them. Drawn as the
// area phones were alerted in: a light fill in the alert class's colour with a
// DASHED border, which keeps them apart from the NWS layer's solid-bordered
// warnings, plus a broadcast marker, since a WEA area is often a 2 km circle
// that would vanish at national zoom. Data: /api/warn/active (server proxy).

const POLL_MS = 60_000;
const FILL_ALPHA = 0.22;
const EDGE_WIDTH = 4;
const EDGE_GAP = Cesium.Color.BLACK.withAlpha(0.6);

const iconCache = new Map<string, string>();
/** Broadcast mark — a dot with radio waves either side — in the class colour. */
function warnIcon(color: string): string {
  const hit = iconCache.get(color);
  if (hit) return hit;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="10.5" fill="#0a0c10" stroke="${color}" stroke-width="2"/>` +
    `<circle cx="12" cy="12" r="1.9" fill="${color}"/>` +
    `<path d="M9.2 9.2a4 4 0 0 0 0 5.6M14.8 9.2a4 4 0 0 1 0 5.6" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round"/>` +
    `<path d="M7 7a7.1 7.1 0 0 0 0 10M17 7a7.1 7.1 0 0 1 0 10" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round"/>` +
    `</svg>`;
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  iconCache.set(color, url);
  return url;
}

/** Where the alert's marker goes: its first circle's centre, else the middle of its largest area. */
function anchorOf(a: WarnAlert): [number, number] | null {
  if (a.circles.length > 0) return [a.circles[0].lon, a.circles[0].lat];
  let best: number[][] | null = null;
  let bestSpan = -1;
  for (const ring of a.polygons) {
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    const span = (Math.max(...lons) - Math.min(...lons)) * (Math.max(...lats) - Math.min(...lats));
    if (span > bestSpan) { best = ring; bestSpan = span; }
  }
  if (!best) return null;
  const pts = best.length > 1 && best[0][0] === best[best.length - 1][0] && best[0][1] === best[best.length - 1][1]
    ? best.slice(0, -1)
    : best;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

function closed(ring: number[][]): number[][] {
  const a = ring[0];
  const b = ring[ring.length - 1];
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
}

export function WarnLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.warn);
  const hideNws = useLayersStore((s) => s.warnHideNws);
  const screensaverActive = useScreensaverStore((s) => s.active);
  const screensaverMode = useScreensaverStore((s) => s.mode);
  const screensaverPhase = useScreensaverStore((s) => s.phase);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const lastSigRef = useRef('');

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('warn');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
      lastSigRef.current = '';
    };
  }, [viewer]);

  // Like the NWS layer: no tinted areas over a property during the pins tour's close-up orbit.
  useEffect(() => {
    const ds = dsRef.current;
    if (!ds || !viewer) return;
    ds.show = !(screensaverActive && screensaverMode === 'pins' && screensaverPhase === 'at-poi');
    viewer.scene.requestRender();
  }, [viewer, screensaverActive, screensaverMode, screensaverPhase]);

  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds) return;
    if (!active) {
      ds.entities.removeAll();
      lastSigRef.current = '';
      useWarnStatus.getState().setStatus({ count: 0, hiddenNws: 0, error: null });
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;
    const load = async () => {
      let alerts: WarnAlert[];
      let heartbeat: string | null;
      let fetchedAt: string | null;
      try {
        const feed = await api.warn();
        alerts = feed.alerts;
        heartbeat = feed.heartbeat;
        fetchedAt = feed.fetchedAt;
      } catch (err) {
        if (cancelled) return;
        console.warn('PBS WARN fetch failed', err);
        useWarnStatus.getState().setStatus({ error: 'PBS WARN feed unavailable' });
        return;
      }
      if (cancelled) return;

      const now = Date.now();
      const live = alerts.filter((a) => !a.expires || !(Date.parse(a.expires) <= now));
      const shown = hideNws ? live.filter((a) => !a.nws) : live;
      useWarnStatus.getState().setStatus({
        count: shown.length,
        hiddenNws: live.length - shown.length,
        heartbeat,
        fetchedAt,
        error: null,
      });
      const sig = `${hideNws ? 1 : 0}|${shown.map((a) => `${a.id}@${a.expires ?? ''}`).join(',')}`;
      if (sig === lastSigRef.current) return;
      lastSigRef.current = sig;

      ds.entities.removeAll();
      ds.entities.suspendEvents();
      try {
        for (const a of shown) {
          const cls = WEA_CLASSES[a.weaClass] ?? WEA_CLASSES['public-safety'];
          const color = Cesium.Color.fromCssColorString(cls.color);
          const { polygons: _p, circles: _c, ...rest } = a;
          const panel = {
            id: `warn-${a.id}`,
            kind: 'warn' as const,
            title: a.event,
            subtitle: a.sender,
            payload: rest as unknown as Record<string, unknown>,
          };
          const rings = [
            ...a.polygons.map(closed),
            ...a.circles.map((c) => circleRing(c.lon, c.lat, c.radiusKm * 1000)),
          ];
          rings.forEach((ring, i) => {
            const positions = Cesium.Cartesian3.fromDegreesArray(ring.flat());
            const fill = ds.entities.add({
              id: `warn-${a.id}-${i}`,
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                material: color.withAlpha(FILL_ALPHA),
              },
            });
            attachPanelData(fill, panel);
            const edge = ds.entities.add({
              id: `warn-${a.id}-${i}-edge`,
              polyline: {
                positions,
                clampToGround: true,
                width: EDGE_WIDTH,
                material: new Cesium.PolylineDashMaterialProperty({ color, gapColor: EDGE_GAP, dashLength: 14 }),
                zIndex: 1,
              },
            });
            attachPanelData(edge, panel);
          });
          const anchor = anchorOf(a);
          if (anchor) {
            const marker = ds.entities.add({
              id: `warn-${a.id}-marker`,
              // Surface anchor + default depth test, so the globe hides far-side markers.
              position: Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1], 0),
              billboard: {
                image: warnIcon(cls.color),
                width: 24,
                height: 24,
                scaleByDistance: new Cesium.NearFarScalar(300_000, 1.15, 8_000_000, 0.6),
              },
              label: {
                text: a.event,
                font: '600 12px Inter, system-ui, sans-serif',
                fillColor: color,
                outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.TOP,
                pixelOffset: new Cesium.Cartesian2(0, 15),
                // Names only once zoomed in to a region; markers always show.
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1_500_000),
              },
            });
            attachPanelData(marker, panel);
          }
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
  }, [viewer, active, hideNws]);

  return null;
}
