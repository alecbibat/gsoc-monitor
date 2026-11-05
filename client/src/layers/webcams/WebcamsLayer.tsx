import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { useLayersStore } from '../../store/layersStore';
import { webcamIcon, WEBCAM_COLOR } from './webcamMeta';
import { useWebcamsFeed, useWebcamsStore } from './webcamsStore';

// ── Park webcams ─────────────────────────────────────────────────────────────
// A camera marker at each of the followed parks' webcams (NPS and partner
// cameras); a click opens its live picture. Shown from a regional zoom in —
// from further out they would only stack onto the parks' pins.

const SHOW_WITHIN_M = 1_500_000;
const NAMES_WITHIN_M = 60_000;

export function WebcamsLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.webcams);
  const feed = useWebcamsStore((s) => s.feed);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  useWebcamsFeed(active);

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
    if (active && feed) {
      ds.entities.suspendEvents();
      try {
        for (const cam of feed.cams) {
          const marker = ds.entities.add({
            id: `webcam-${cam.id}`,
            // Surface anchor + default depth test, so the globe hides far-side markers.
            position: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, 0),
            billboard: {
              image: webcamIcon(cam.kind),
              width: 22,
              height: 22,
              scaleByDistance: new Cesium.NearFarScalar(20_000, 1.1, SHOW_WITHIN_M, 0.7),
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
              pixelOffset: new Cesium.Cartesian2(0, 14),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, NAMES_WITHIN_M),
            },
          });
          attachPanelData(marker, {
            id: `webcam-${cam.id}`,
            kind: 'webcams',
            title: cam.name,
            subtitle: `${cam.park} · ${cam.operator}`,
            payload: cam as unknown as Record<string, unknown>,
          });
        }
      } finally {
        ds.entities.resumeEvents();
      }
    }
    viewer.scene.requestRender();
  }, [viewer, active, feed]);

  return null;
}
