import type { PanelOpenData } from '../../panels/panelStore';
import type { RawAlert } from './alertsData';

/** The alert's id as the map layer keys it (feature properties first). */
export function alertId(alert: RawAlert): string | undefined {
  return alert.properties.id ?? alert.id;
}

/**
 * The detail panel for one NWS alert — what a click on its polygon opens, and
 * what the pin notifier's "Show on map" opens. `id` overrides the alert's own
 * (the layer falls back to a draw index for an alert with neither id).
 */
export function alertPanelData(alert: RawAlert, id = alertId(alert) ?? 'unknown'): PanelOpenData {
  const p = alert.properties;
  return {
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
      sent: p.sent ?? null,
      effective: p.effective ?? '',
      onset: p.onset ?? null,
      ends: p.ends ?? null,
      expires: p.expires ?? '',
      areaDesc: p.areaDesc ?? '',
    },
  };
}
