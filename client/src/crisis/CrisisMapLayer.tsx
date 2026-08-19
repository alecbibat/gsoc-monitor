import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useCrisisStore, type DrawLayer } from './crisisStore';

const ENTITY_PREFIX = 'crisis-layer-';

/**
 * The drawn layer a picked Cesium entity belongs to, or null when the pick
 * landed on something else. Shared with the share-link globe, which does its
 * own click-to-identify against the same entities.
 */
export function layerIdFromEntity(entityId: unknown): string | null {
  return typeof entityId === 'string' && entityId.startsWith(ENTITY_PREFIX)
    ? entityId.slice(ENTITY_PREFIX.length)
    : null;
}

function centroid(layer: DrawLayer): { lon: number; lat: number } {
  const n = layer.positions.length;
  const sum = layer.positions.reduce(
    (acc, p) => ({ lon: acc.lon + p.lon, lat: acc.lat + p.lat }),
    { lon: 0, lat: 0 }
  );
  return { lon: sum.lon / n, lat: sum.lat / n };
}

// Exported for CrisisShareGlobe, which renders the same drawn layers on the
// public share page's standalone viewer.
export function addLayerEntities(ds: Cesium.CustomDataSource, layer: DrawLayer) {
  if (layer.positions.length === 0) return;
  const color = Cesium.Color.fromCssColorString(layer.color);
  const positions = layer.positions.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
  const id = `${ENTITY_PREFIX}${layer.id}`;

  const labelPos = centroid(layer);
  // Name only. The shape's measurements (length, area, position) are a
  // detail-on-demand thing: they live in the click-to-identify popup, the
  // layer lists and the share report — a map of shapes each carrying two
  // lines of figures is unreadable at a glance, which is what a map is for.
  const labelGraphics: Cesium.LabelGraphics.ConstructorOptions = {
    text: layer.name,
    font: '600 11px Inter, system-ui, sans-serif',
    fillColor: Cesium.Color.WHITE,
    outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
    outlineWidth: 3,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    pixelOffset: new Cesium.Cartesian2(0, layer.geometry === 'point' ? -16 : 0),
    // Default depth test so labels on the far side of the planet are hidden
    // behind the globe instead of showing through it.
    translucencyByDistance: new Cesium.NearFarScalar(5_000, 1.0, 8_000_000, 0.0),
    showBackground: layer.geometry !== 'point',
    backgroundColor: Cesium.Color.BLACK.withAlpha(0.4),
    backgroundPadding: new Cesium.Cartesian2(6, 3),
  };

  // POINT
  if (layer.geometry === 'point' || (layer.geometry !== 'line' && positions.length < 2)) {
    ds.entities.add({
      id,
      position: positions[0],
      point: {
        pixelSize: 13,
        color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        // Default depth test — far-side markers hide behind the globe.
      },
      label: labelGraphics,
    });
    return;
  }

  // LINE
  if (layer.geometry === 'line' || positions.length < 3) {
    const directional = layer.geometry === 'line' && layer.directional;
    ds.entities.add({
      id,
      position: Cesium.Cartesian3.fromDegrees(labelPos.lon, labelPos.lat),
      polyline: {
        positions,
        // The arrow material draws its shaft thinner than the nominal width,
        // so directional lines get a wider polyline for a legible arrowhead.
        width: directional ? 12 : 4,
        material: directional
          ? new Cesium.PolylineArrowMaterialProperty(color.withAlpha(0.95))
          : color.withAlpha(0.95),
        // Arrow material misrenders on ground-clamped polylines (per-segment
        // heads); with no terrain configured, a surface-height geodesic line
        // sits on the globe identically, so directional lines skip clamping.
        clampToGround: !directional,
        arcType: Cesium.ArcType.GEODESIC,
      },
      label: labelGraphics,
    });
    return;
  }

  // POLYGON (fill + outline)
  ds.entities.add({
    id,
    position: Cesium.Cartesian3.fromDegrees(labelPos.lon, labelPos.lat),
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(positions),
      material: color.withAlpha(0.22),
      outline: true,
      outlineColor: color.withAlpha(0.95),
      outlineWidth: 2,
      height: 0,
      arcType: Cesium.ArcType.GEODESIC,
    },
    label: labelGraphics,
  });
}

export function CrisisMapLayer() {
  const viewer = useCesiumViewer();
  const incidents = useCrisisStore((s) => s.incidents);
  const activeIncidentId = useCrisisStore((s) => s.activeIncidentId);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  // Data source lifecycle
  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('crisis-layers');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
    };
  }, [viewer]);

  // Render all visible layers across all incidents.
  //
  // Stood-down (archived) incidents are kept off the globe so the map isn't
  // cluttered with concluded events — except while that incident is the one
  // currently being viewed, when its layers reappear temporarily. Opening an
  // archived incident sets it as active; navigating back to the list clears it
  // and the layers hide again.
  useEffect(() => {
    const ds = dsRef.current;
    if (!ds || !viewer) return;
    ds.entities.removeAll();
    incidents.forEach((inc) => {
      if (inc.archivedAt && inc.id !== activeIncidentId) return;
      inc.drawLayers
        .filter((l) => l.visible && l.positions.length > 0)
        .forEach((layer) => addLayerEntities(ds, layer));
    });
    viewer.scene.requestRender();
  }, [viewer, incidents, activeIncidentId]);

  // Click-to-identify: clicking a drawn layer opens its info popup
  useEffect(() => {
    if (!viewer) return;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const st = useCrisisStore.getState();
      if (st.open || st.activeDrawLayerId) return; // not while editing or drawing
      const picked = viewer.scene.pick(e.position);
      const layerId = layerIdFromEntity((picked?.id as Cesium.Entity | undefined)?.id);
      if (layerId) {
        st.setPickedLayer({ layerId, x: e.position.x, y: e.position.y });
      } else if (st.pickedLayer) {
        st.setPickedLayer(null);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    return () => handler.destroy();
  }, [viewer]);

  return null;
}
