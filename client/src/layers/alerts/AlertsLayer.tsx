import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { attachPanelData, getPanelData } from '../../cesium/entityPanelLink';
import { usePanelStore } from '../../panels/panelStore';
import { useAlertsStatus } from './alertsStore';
import { useScreensaverStore } from '../../screensaver/screensaverStore';
import {
  fetchActiveAlerts,
  loadCounties,
  alertRings,
  alertColorHex,
  severityRank,
  type RawAlert,
} from './alertsData';

// Each alert ring entity stashes its un-highlighted base colour so the highlight
// effect can toggle between resting and lit-up styling without re-deriving it.
interface AlertEntity extends Cesium.Entity {
  gsocAlertColor?: Cesium.Color;
}

// Resting vs. highlighted fill opacity. Highlighted fills are translucent on
// purpose: where two highlighted alerts overlap, their fills stack and the
// shared area reads as a more intense colour — the "addition" of both areas.
const FILL_REST = 0.28;
const FILL_LIT = 0.5;

// Re-style every alert polygon: alerts whose info panel is open get a brighter
// fill and a white-tinged outline; the rest return to resting styling.
function applyAlertHighlights(ds: Cesium.CustomDataSource, openIds: Set<string>) {
  for (const entity of ds.entities.values) {
    const link = getPanelData(entity);
    const base = (entity as AlertEntity).gsocAlertColor;
    if (!link || link.kind !== 'alerts' || !base || !entity.polygon) continue;
    const lit = openIds.has(link.id);
    entity.polygon.material = new Cesium.ColorMaterialProperty(
      base.withAlpha(lit ? FILL_LIT : FILL_REST)
    );
    entity.polygon.outlineColor = new Cesium.ConstantProperty(
      lit
        ? Cesium.Color.lerp(base, Cesium.Color.WHITE, 0.55, new Cesium.Color()).withAlpha(1)
        : base.withAlpha(0.9)
    );
    entity.polygon.outlineWidth = new Cesium.ConstantProperty(lit ? 3 : 2);
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
      const countiesPromise = loadCounties().catch((err) => {
        console.warn('NWS alerts: county geometry unavailable', err);
        return null;
      });

      let alerts: RawAlert[];
      try {
        alerts = await fetchActiveAlerts();
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
        const sig = alerts.map((a) => a.properties.id ?? a.id ?? '').join('|');
        if (sig === lastSigRef.current) {
          useAlertsStatus.getState().setStatus({ error: null });
          return;
        }
        lastSigRef.current = sig;

        // Draw higher-severity polygons last so they sit on top.
        const sorted = [...alerts].sort(
          (a, b) => severityRank(a.properties.severity) - severityRank(b.properties.severity)
        );

        ds.entities.removeAll();
        let drawn = 0;
        for (const alert of sorted) {
          const rings = alertRings(alert, counties);
          if (rings.length === 0) continue;
          const p = alert.properties;
          const color = Cesium.Color.fromCssColorString(
            alertColorHex(p.event ?? '', p.severity ?? 'Unknown')
          );
          const id = p.id ?? alert.id ?? `${drawn}`;

          rings.forEach((ring, idx) => {
            const positions = Cesium.Cartesian3.fromDegreesArray(ring.flat());
            const entity = ds.entities.add({
              id: `alert-${id}-${idx}`,
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                material: color.withAlpha(FILL_REST),
                outline: true,
                outlineColor: color.withAlpha(0.9),
                outlineWidth: 2,
              },
            });
            (entity as AlertEntity).gsocAlertColor = color;
            attachPanelData(entity, {
              id: `alert-${id}`,
              kind: 'alerts',
              title: p.event ?? 'Alert',
              subtitle: p.areaDesc ?? '',
              payload: {
                event: p.event ?? 'Alert',
                headline: p.headline ?? null,
                description: p.description ?? '',
                instruction: p.instruction ?? null,
                severity: p.severity ?? 'Unknown',
                urgency: p.urgency ?? 'Unknown',
                certainty: p.certainty ?? 'Unknown',
                senderName: p.senderName ?? '',
                effective: p.effective ?? '',
                expires: p.expires ?? '',
                areaDesc: p.areaDesc ?? '',
              },
            });
          });
          drawn++;
        }

        // Re-apply highlights to the freshly drawn entities so any alert whose
        // panel is currently open stays lit through the periodic refresh.
        const openIds = new Set(
          usePanelStore.getState().panels.filter((p) => p.kind === 'alerts').map((p) => p.id)
        );
        applyAlertHighlights(ds, openIds);

        useAlertsStatus.getState().setStatus({ count: drawn, error: null });
        viewer.scene.requestRender();
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load NWS alerts', err);
        useAlertsStatus.getState().setStatus({ error: 'NWS alert feed unavailable' });
      }
    };

    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [viewer, active]);

  return null;
}
