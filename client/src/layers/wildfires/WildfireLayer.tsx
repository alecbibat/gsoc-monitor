import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { useWildfiresStatus } from './wildfiresStore';
import { fetchWildfires, containmentColor } from './wildfiresData';

// A flame-in-ring marker — the ring reads as a named, managed incident, versus
// the bare flames the FIRMS satellite layer draws.
const iconCache = new Map<string, string>();
function fireMarkerIcon(color: string): string {
  const cached = iconCache.get(color);
  if (cached) return cached;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28">` +
    `<circle cx="14" cy="14" r="11" fill="#0a0c10" stroke="${color}" stroke-width="2.5"/>` +
    `<path d="M14 6C11.5 9 10 12 10 15.2C10 18.6 11.8 21 14 21C16.2 21 18 18.6 18 15.2C18 12 16.5 9 14 6Z" fill="${color}"/>` +
    `<path d="M14 12C12.9 13.8 12.4 15.2 12.4 16.6C12.4 18.4 13.1 19.6 14 19.6C14.9 19.6 15.6 18.4 15.6 16.6C15.6 15.2 15.1 13.8 14 12Z" fill="#fff2b0"/>` +
    `</svg>`;
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  iconCache.set(color, url);
  return url;
}

function acresLabel(acres: number | null): string {
  if (acres == null) return '';
  if (acres >= 10000) return `${Math.round(acres / 1000)}k ac`;
  if (acres >= 1000) return `${(acres / 1000).toFixed(1)}k ac`;
  return `${Math.round(acres)} ac`;
}

export function WildfireLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.wildfires);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('wildfires');
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
      useWildfiresStatus.getState().setStatus({ count: 0, error: null });
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;
    const load = async () => {
      const { fires, perimeters, error } = await fetchWildfires();
      if (cancelled) return;
      if (error && fires.length === 0) {
        console.error('NIFC wildfire feed fetch failed', error);
        useWildfiresStatus.getState().setStatus({ error: `NIFC feed error: ${error}` });
        return;
      }

      ds.entities.removeAll();

      // Fire-perimeter footprints first, as background context.
      for (const perim of perimeters) {
        for (const ring of perim.rings) {
          ds.entities.add({
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring.flat())),
              material: Cesium.Color.fromCssColorString('#ff5a1f').withAlpha(0.16),
              outline: true,
              outlineColor: Cesium.Color.fromCssColorString('#ff5a1f').withAlpha(0.8),
            },
          });
        }
      }

      // Named-incident markers + labels, clickable for the response panel.
      for (const fire of fires) {
        const color = containmentColor(fire.contained);
        const id = `wildfire-${fire.id}`;
        const acres = acresLabel(fire.acres);
        const ent = ds.entities.add({
          id,
          position: Cesium.Cartesian3.fromDegrees(fire.lon, fire.lat),
          billboard: {
            image: fireMarkerIcon(color),
            width: 24,
            height: 24,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(500_000, 1.15, 12_000_000, 0.6),
          },
          label: {
            text: acres ? `${fire.name} · ${acres}` : fire.name,
            font: '600 12px Inter, system-ui, sans-serif',
            fillColor: Cesium.Color.fromCssColorString(color),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(0, 15),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            // Hide the name when zoomed way out; the markers still show.
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4_000_000),
          },
        });
        attachPanelData(ent, {
          id,
          kind: 'wildfires',
          title: fire.name,
          subtitle: fire.contained != null ? `${fire.contained}% contained` : 'Active wildfire',
          payload: { ...fire },
        });
      }

      useWildfiresStatus.getState().setStatus({ count: fires.length, error: null });
      viewer.scene.requestRender();
    };

    load();
    // WFIGS incident attributes refresh as ICS-209 / IRWIN reports land (roughly
    // daily); 5 min keeps new/updated fires current cheaply.
    const interval = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [viewer, active]);

  return null;
}
