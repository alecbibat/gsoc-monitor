import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { api } from '../../api/client';
import { startVisiblePolling } from '../../lib/poll';
import { useLayersStore } from '../../store/layersStore';
import { NPS_PARK_BY_CODE } from '../../nps/parks';
import type { RoadClosure } from '../../types';
import { ROAD_IMPACT, roadIcon, summarizeByPark, summaryText } from './roadsMeta';
import { useRoadsStatus } from './roadsStore';

// ── Road closures around the followed national parks ─────────────────────────
// Closures and restrictions in force near Glacier, Yellowstone, Grand Canyon,
// Death Valley, Rocky Mountain and Mount Rushmore, merged server-side from the
// NPS road-event feed and state DOT 511 feeds (/api/roads/closures). Each is
// drawn along the road — solid red over a dark casing when closed, dashed
// amber when restricted — with a sign marker at each. From further out than a
// region, where dozens of signs would pile onto the property pins, each park
// shows one badge with its counts instead ("17 closed").

const POLL_MS = 5 * 60_000;
/** Camera distance at which the per-park badges give way to individual signs. */
const SIGNS_WITHIN_M = 1_200_000;
const BADGE_EYE_OFFSET = new Cesium.Cartesian3(0, 0, -50_000);
const CASING = Cesium.Color.BLACK.withAlpha(0.6);

function signature(list: RoadClosure[]): string {
  return list.map((c) => `${c.id}@${c.end ?? ''}#${c.impact}${c.lines.length}`).join(',');
}

export function RoadClosuresLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.roads);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const lastSigRef = useRef('');

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('roads');
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
      useRoadsStatus.getState().setStatus({ closed: 0, restricted: 0, error: null });
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;
    const load = async () => {
      let closures: RoadClosure[];
      try {
        const feed = await api.roadClosures();
        if (cancelled) return;
        closures = feed.closures;
        useRoadsStatus.getState().setStatus({
          closed: closures.filter((c) => c.impact === 'closed').length,
          restricted: closures.filter((c) => c.impact === 'restricted').length,
          sources: feed.sources,
          fetchedAt: feed.fetchedAt,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        console.warn('Road closures fetch failed', err);
        useRoadsStatus.getState().setStatus({ error: 'Road closures unavailable' });
        return;
      }

      const sig = signature(closures);
      if (sig === lastSigRef.current) return;
      lastSigRef.current = sig;

      ds.entities.removeAll();
      ds.entities.suspendEvents();
      try {
        for (const c of closures) {
          const meta = ROAD_IMPACT[c.impact];
          const color = Cesium.Color.fromCssColorString(meta.color);
          const panel = {
            id: `road-${c.id}`,
            kind: 'roads' as const,
            title: c.title,
            subtitle: c.sourceLabel,
            payload: c as unknown as Record<string, unknown>,
          };
          c.lines.forEach((line, i) => {
            const positions = Cesium.Cartesian3.fromDegreesArray(line.flat());
            const casing = ds.entities.add({
              id: `road-${c.id}-${i}-casing`,
              polyline: { positions, clampToGround: true, width: 9, material: CASING, zIndex: 2 },
            });
            attachPanelData(casing, panel);
            const stroke = ds.entities.add({
              id: `road-${c.id}-${i}`,
              polyline: {
                positions,
                clampToGround: true,
                width: 5,
                material:
                  c.impact === 'closed'
                    ? new Cesium.ColorMaterialProperty(color)
                    : new Cesium.PolylineDashMaterialProperty({ color, gapColor: CASING, dashLength: 12 }),
                zIndex: 3,
              },
            });
            attachPanelData(stroke, panel);
          });
          if (c.point) {
            const label = c.roadNames.length ? c.roadNames.join(' / ') : c.title;
            const marker = ds.entities.add({
              id: `road-${c.id}-marker`,
              // Surface anchor + default depth test, so the globe hides
              // far-side markers (clamping skips that path; see LocationsLayer).
              position: Cesium.Cartesian3.fromDegrees(c.point[0], c.point[1], 0),
              billboard: {
                image: roadIcon(c.impact),
                width: 22,
                height: 22,
                scaleByDistance: new Cesium.NearFarScalar(50_000, 1.1, SIGNS_WITHIN_M, 0.75),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, SIGNS_WITHIN_M),
              },
              label: {
                text: label,
                font: '600 12px Inter, system-ui, sans-serif',
                fillColor: color,
                outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.TOP,
                pixelOffset: new Cesium.Cartesian2(0, 14),
                // Road names only once zoomed in past a whole-park view, where
                // a park's dozen closures would stack their labels.
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 150_000),
              },
            });
            attachPanelData(marker, panel);
          }
        }
        // One badge per park for the far view.
        for (const s of summarizeByPark(closures)) {
          const park = NPS_PARK_BY_CODE.get(s.parkCode);
          if (!park) continue;
          const [w, so, e, n] = park.bbox;
          const impact = s.closed > 0 ? 'closed' : 'restricted';
          ds.entities.add({
            id: `road-summary-${s.parkCode}`,
            position: Cesium.Cartesian3.fromDegrees((w + e) / 2, (so + n) / 2, 0),
            // Hung just below the point: the property pins stand above theirs,
            // so from this far out the badge sits under the park's pin cluster.
            billboard: {
              image: roadIcon(impact),
              width: 18,
              height: 18,
              verticalOrigin: Cesium.VerticalOrigin.TOP,
              pixelOffset: new Cesium.Cartesian2(0, 6),
              // Drawn in front of nearby pins (50 km nearer the camera — nothing
              // at this range, and far too little to defeat far-side occlusion).
              eyeOffset: BADGE_EYE_OFFSET,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(SIGNS_WITHIN_M, Number.MAX_VALUE),
            },
            label: {
              text: summaryText(s),
              font: '700 11px Inter, system-ui, sans-serif',
              fillColor: Cesium.Color.fromCssColorString(ROAD_IMPACT[impact].color),
              outlineColor: Cesium.Color.BLACK.withAlpha(0.9),
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
              verticalOrigin: Cesium.VerticalOrigin.TOP,
              pixelOffset: new Cesium.Cartesian2(12, 9),
              eyeOffset: BADGE_EYE_OFFSET,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(SIGNS_WITHIN_M, Number.MAX_VALUE),
            },
          });
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
