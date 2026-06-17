import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { useWebcamsStatus, useWebcamsData } from './webcamsStore';
import type { Webcam } from '../../types';

// A camera glyph on a rounded pin. Colored amber when the cam is offline so
// stale feeds read at a glance.
function cameraIcon(active: boolean): string {
  const fill = active ? '#38bdf8' : '#f59e0b';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="22" fill="${fill}" stroke="#05222b" stroke-width="3"/>` +
    `<rect x="18" y="25" width="20" height="14" rx="2.5" fill="#05222b"/>` +
    `<path d="M38 29 L46 25 L46 39 L38 35 Z" fill="#05222b"/>` +
    `<circle cx="27" cy="32" r="3.4" fill="${fill}"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const ICON_ACTIVE = cameraIcon(true);
const ICON_OFFLINE = cameraIcon(false);

function isActive(status: string): boolean {
  return status.toLowerCase() !== 'disabled';
}

export function WebcamsLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.webcams);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

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

    if (!active) {
      ds.entities.removeAll();
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const data = await api.webcams();
        if (cancelled) return;

        useWebcamsData.getState().setWebcams(data.webcams);

        ds.entities.removeAll();
        for (const cam of data.webcams) {
          const entity = ds.entities.add({
            id: `webcam-${cam.id}`,
            position: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, 0),
            billboard: {
              image: isActive(cam.status) ? ICON_ACTIVE : ICON_OFFLINE,
              width: 26,
              height: 26,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              // Fade in only when reasonably zoomed in so the globe view isn't
              // cluttered with camera pins.
              scaleByDistance: new Cesium.NearFarScalar(2.0e5, 1.0, 4.0e6, 0.35),
            },
          });
          attachPanelData(entity, {
            id: `webcam-${cam.id}`,
            kind: 'webcams',
            title: cam.title,
            subtitle: `${cam.distanceMi} mi from ${cam.nearestPin}`,
            payload: { ...cam } as unknown as Record<string, unknown>,
          });
        }

        useWebcamsStatus.getState().setStatus({
          count: data.webcams.length,
          statesActive: data.providers.filter((p) => p.count > 0).length,
          error: null,
        });
        viewer.scene.requestRender();
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load webcams', err);
        useWebcamsStatus.getState().setStatus({ error: 'Webcam feed unavailable' });
      }
    };

    load();
    // The set of nearby cams changes slowly; the server caches 6h, so a 15-min
    // client poll is plenty to pick up the occasional change.
    const interval = setInterval(load, 15 * 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [viewer, active]);

  return null;
}

export type { Webcam };
