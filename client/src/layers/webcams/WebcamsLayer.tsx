import * as Cesium from 'cesium';
import { useEffect, useMemo, useRef } from 'react';
import { TERRAIN_MARKERS_ON_TOP_M, useGroundHeights } from '../../cesium/groundHeights';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { useLayersStore } from '../../store/layersStore';
import { spotSlots, webcamIcon, WEBCAM_COLOR } from './webcamMeta';
import { useWebcamsFeed, useWebcamsStore } from './webcamsStore';

// ── Park webcams ─────────────────────────────────────────────────────────────
// A camera marker at each of the followed parks' webcams (NPS and partner
// cameras); a click opens its live picture. Shown from a regional zoom in —
// from further out they would only stack onto the parks' pins.

const SHOW_WITHIN_M = 1_500_000;
const NAMES_WITHIN_M = 60_000;
/** Cameras at one spot (Logan Pass has three) sit side by side, this far apart. */
const SIDE_BY_SIDE_PX = 26;
const LABEL_LINE_PX = 15;

export function WebcamsLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.webcams);
  const feed = useWebcamsStore((s) => s.feed);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  useWebcamsFeed(active);
  // With 3D terrain on, cameras draw over buildings up close and stand on the
  // ground (cesium/groundHeights.ts).
  const cams = useMemo(() => feed?.cams ?? [], [feed]);
  const { terrain, heights } = useGroundHeights(viewer, cams, cams.map((c) => `${c.id}@${c.lon},${c.lat}`).join(';'));

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('webcams');
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
    ds.entities.removeAll();
    if (active && cams.length > 0) {
      const onTop = terrain ? TERRAIN_MARKERS_ON_TOP_M : undefined;
      const slots = spotSlots(cams);
      ds.entities.suspendEvents();
      try {
        cams.forEach((cam, i) => {
          // Side by side at a shared spot, the names listed below in the same order.
          const { index, count } = slots[i];
          const marker = ds.entities.add({
            id: `webcam-${cam.id}`,
            // Surface anchor + default depth test, so the globe hides
            // far-side markers; on real terrain, the ground under the camera.
            position: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, heights?.[i] ?? 0),
            billboard: {
              disableDepthTestDistance: onTop,
              image: webcamIcon(cam.kind),
              width: 22,
              height: 22,
              scaleByDistance: new Cesium.NearFarScalar(20_000, 1.1, SHOW_WITHIN_M, 0.7),
              pixelOffset: new Cesium.Cartesian2((index - (count - 1) / 2) * SIDE_BY_SIDE_PX, 0),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, SHOW_WITHIN_M),
            },
            label: {
              text: cam.name,
              font: '600 12px Inter, system-ui, sans-serif',
              fillColor: Cesium.Color.fromCssColorString(WEBCAM_COLOR),
              outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.TOP,
              pixelOffset: new Cesium.Cartesian2(0, 14 + index * LABEL_LINE_PX),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, NAMES_WITHIN_M),
              disableDepthTestDistance: onTop,
            },
          });
          attachPanelData(marker, {
            id: `webcam-${cam.id}`,
            kind: 'webcams',
            title: cam.name,
            subtitle: `${cam.park} · ${cam.operator}`,
            payload: cam as unknown as Record<string, unknown>,
          });
        });
      } finally {
        ds.entities.resumeEvents();
      }
    }
    viewer.scene.requestRender();
  }, [viewer, active, cams, terrain, heights]);

  return null;
}
