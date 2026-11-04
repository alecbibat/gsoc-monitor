import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData, getPanelData } from '../../cesium/entityPanelLink';
import { usePanelStore } from '../../panels/panelStore';
import { useAlertsStatus } from './alertsStore';
import { useScreensaverStore } from '../../screensaver/screensaverStore';
import { startVisiblePolling } from '../../lib/poll';
import {
  fetchActiveAlertsShared,
  loadCountyAtlas,
  alertRings,
  alertOutline,
  alertColorHex,
  severityRank,
  type CountyAtlas,
  type RawAlert,
} from './alertsData';
import { alertPanelData } from './alertPanel';

// Each alert entity (fill polygon or border line) stashes its un-highlighted
// styling inputs so the highlight effect can toggle between resting and lit-up
// styling without re-deriving them.
interface AlertEntity extends Cesium.Entity {
  gsocAlertColor?: Cesium.Color;
  gsocFillAlpha?: number; // resting fill opacity (fill polygons only)
  gsocLit?: boolean; // lit state currently applied to this entity's styling
}

// Resting fill opacity by severity, so warnings read louder than advisories.
// A lit (panel open) fill adds FILL_LIT_BOOST and stays translucent on
// purpose: where two highlighted alerts overlap, their fills stack and the
// shared area reads as a more intense colour — the "addition" of both areas.
const FILL_REST: Record<string, number> = { Extreme: 0.42, Severe: 0.38, Moderate: 0.32 };
const FILL_REST_DEFAULT = 0.26; // Minor / Unknown
const FILL_LIT_BOOST = 0.22;

// Borders are ground-clamped polylines. Cesium drops `outline` on polygons
// clamped to the ground (with a one-time console warning) and WebGL caps plain
// line widths at 1 px on most platforms, so the polygons used to have no edge
// at all. A bright core in the alert's colour inside a dark casing reads on the
// dark, light and satellite basemaps alike. zIndex 1 keeps every border above
// every fill (both share the data source's ordered ground collection).
const EDGE_CASING = Cesium.Color.BLACK.withAlpha(0.75);
const EDGE_WIDTH = { rest: 5, lit: 7 }; // px, casing included
const EDGE_CASING_WIDTH = { rest: 2, lit: 3 }; // px, both sides together
const EDGE_Z = 1;

function fillMaterial(base: Cesium.Color, restAlpha: number, lit: boolean): Cesium.ColorMaterialProperty {
  return new Cesium.ColorMaterialProperty(base.withAlpha(lit ? restAlpha + FILL_LIT_BOOST : restAlpha));
}

function edgeMaterial(base: Cesium.Color, lit: boolean): Cesium.PolylineOutlineMaterialProperty {
  return new Cesium.PolylineOutlineMaterialProperty({
    color: lit ? Cesium.Color.lerp(base, Cesium.Color.WHITE, 0.55, new Cesium.Color()) : base.withAlpha(1),
    outlineColor: EDGE_CASING,
    outlineWidth: lit ? EDGE_CASING_WIDTH.lit : EDGE_CASING_WIDTH.rest,
  });
}

// Re-style the alert entities: alerts whose info panel is open get a brighter
// fill and a wider, white-tinged border; the rest return to resting styling.
function applyAlertHighlights(ds: Cesium.CustomDataSource, openIds: Set<string>) {
  for (const entity of ds.entities.values) {
    const link = getPanelData(entity);
    const alertEntity = entity as AlertEntity;
    const base = alertEntity.gsocAlertColor;
    if (!link || link.kind !== 'alerts' || !base) continue;
    const lit = openIds.has(link.id);
    // Unchanged: leave the properties alone. Any property assignment makes
    // Cesium rebuild this entity's ground-primitive batch.
    if (alertEntity.gsocLit === lit) continue;
    if (entity.polygon) {
      entity.polygon.material = fillMaterial(base, alertEntity.gsocFillAlpha ?? FILL_REST_DEFAULT, lit);
    } else if (entity.polyline) {
      entity.polyline.material = edgeMaterial(base, lit);
      entity.polyline.width = new Cesium.ConstantProperty(lit ? EDGE_WIDTH.lit : EDGE_WIDTH.rest);
    }
    alertEntity.gsocLit = lit;
  }
}

export function AlertsLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.alerts);
  const screensaverMode = useScreensaverStore((s) => s.mode);
  const screensaverPhase = useScreensaverStore((s) => s.phase);
  const screensaverActive = useScreensaverStore((s) => s.active);
  // Stable signature of the open alert panel ids — only changes when an alert
  // panel is opened or closed (not on drag/dock/z-order churn).
  const openAlertSig = usePanelStore((s) =>
    s.panels
      .filter((p) => p.kind === 'alerts')
      .map((p) => p.id)
      .sort()
      .join('|')
  );
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);
  const lastSigRef = useRef<string>('');

  // Hide alert polygon tints during the PINS screensaver close-up orbit —
  // the coloured fills look wrong at building-level altitude.
  useEffect(() => {
    const ds = dsRef.current;
    if (!ds || !viewer) return;
    const closeUp = screensaverActive && screensaverMode === 'pins' && screensaverPhase === 'at-poi';
    ds.show = !closeUp;
    viewer.scene.requestRender();
  }, [viewer, screensaverActive, screensaverMode, screensaverPhase]);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('alerts');
    dsRef.current = ds;
    viewer.dataSources.add(ds);
    return () => {
      viewer.dataSources.remove(ds, true);
      dsRef.current = null;
      // The next viewer gets a fresh, empty data source: its first load must
      // redraw rather than match the old signature and skip.
      lastSigRef.current = '';
    };
  }, [viewer]);

  // Light up the alert(s) whose info panel is open; un-light the rest. Runs
  // whenever an alert panel opens or closes.
  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds) return;
    const openIds = new Set(openAlertSig ? openAlertSig.split('|') : []);
    applyAlertHighlights(ds, openIds);
    viewer.scene.requestRender();
  }, [viewer, openAlertSig]);

  useEffect(() => {
    const ds = dsRef.current;
    if (!viewer || !ds) return;

    if (!active) {
      ds.entities.removeAll();
      lastSigRef.current = '';
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;

    const load = async () => {
      // Counties are a best-effort enhancement (they fill in non-storm alerts
      // that lack their own polygon). Never let a county-file hiccup take down
      // the whole layer — fall back to drawing only alerts that ship geometry.
      const countiesPromise: Promise<CountyAtlas | null> = loadCountyAtlas().catch((err) => {
        console.warn('NWS alerts: county geometry unavailable', err);
        return null;
      });

      let alerts: RawAlert[];
      try {
        alerts = await fetchActiveAlertsShared();
      } catch (err) {
        if (cancelled) return;
        console.error('NWS alerts fetch failed', err);
        const reason = err instanceof Error ? err.message : 'unreachable';
        useAlertsStatus.getState().setStatus({ error: `NWS feed error: ${reason}` });
        return;
      }

      const counties = await countiesPromise;
      if (cancelled) return;

      try {
        // County availability participates: after a failed county download,
        // the first poll with counties back must draw the county-based alerts.
        const sig =
          (counties ? 'c|' : 'n|') + alerts.map((a) => a.properties.id ?? a.id ?? '').join('|');
        if (sig === lastSigRef.current) {
          useAlertsStatus.getState().setStatus({ error: null });
          return;
        }
        lastSigRef.current = sig;

        // Draw higher-severity polygons last so they sit on top.
        const sorted = [...alerts].sort(
          (a, b) => severityRank(a.properties.severity) - severityRank(b.properties.severity)
        );

        // Create each polygon already styled for its lit state (alerts whose
        // panel is open stay lit through the periodic refresh), so nothing has
        // to be restyled — and its batch rebuilt — right after it is drawn.
        const openIds = new Set(
          usePanelStore.getState().panels.filter((p) => p.kind === 'alerts').map((p) => p.id)
        );

        ds.entities.removeAll();
        // One collection-changed notification for the whole redraw instead of
        // one per entity.
        ds.entities.suspendEvents();
        let drawn = 0;
        try {
          for (const alert of sorted) {
            const rings = alertRings(alert, counties?.geometries ?? null);
            if (rings.length === 0) continue;
            const p = alert.properties;
            const color = Cesium.Color.fromCssColorString(
              alertColorHex(p.event ?? '', p.severity ?? 'Unknown')
            );
            const restAlpha = FILL_REST[p.severity ?? ''] ?? FILL_REST_DEFAULT;
            const id = p.id ?? alert.id ?? `${drawn}`;
            const panel = alertPanelData(alert, id);
            const lit = openIds.has(panel.id);

            rings.forEach((ring, idx) => {
              const entity = ds.entities.add({
                id: `alert-${id}-${idx}`,
                polygon: {
                  hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring.flat())),
                  material: fillMaterial(color, restAlpha, lit),
                },
              });
              (entity as AlertEntity).gsocAlertColor = color;
              (entity as AlertEntity).gsocFillAlpha = restAlpha;
              (entity as AlertEntity).gsocLit = lit;
              attachPanelData(entity, panel);
            });

            alertOutline(alert, counties).forEach((line, idx) => {
              if (line.length < 2) return;
              const entity = ds.entities.add({
                id: `alert-${id}-edge-${idx}`,
                polyline: {
                  positions: Cesium.Cartesian3.fromDegreesArray(line.flat()),
                  clampToGround: true,
                  width: lit ? EDGE_WIDTH.lit : EDGE_WIDTH.rest,
                  material: edgeMaterial(color, lit),
                  zIndex: EDGE_Z,
                },
              });
              (entity as AlertEntity).gsocAlertColor = color;
              (entity as AlertEntity).gsocLit = lit;
              attachPanelData(entity, panel);
            });
            drawn++;
          }
        } finally {
          ds.entities.resumeEvents();
        }

        useAlertsStatus.getState().setStatus({ count: drawn, error: null });
        viewer.scene.requestRender();
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load NWS alerts', err);
        useAlertsStatus.getState().setStatus({ error: 'NWS alert feed unavailable' });
      }
    };

    const stopPolling = startVisiblePolling(() => void load(), 60_000);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [viewer, active]);

  return null;
}
