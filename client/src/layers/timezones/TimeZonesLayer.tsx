import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { useTimeZonesStatus } from './timezonesStore';

// Natural Earth 10m timezone polygons via jsDelivr CDN — no API key required.
// Source: https://github.com/nvkelso/natural-earth-vector
const DATA_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_time_zones.geojson';

// Try several property-name spellings that appear in different NE releases.
function parseOffset(props: Record<string, unknown>): number | null {
  const raw =
    props['zone'] ??
    props['Zone'] ??
    props['ZONE'] ??
    props['utc_format'] ??
    props['UTC_FORMAT'] ??
    props['time_zone'];
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const m = raw.match(/([+-]?\d+(?:[.,]\d+)?)/);
    if (m) return parseFloat(m[1].replace(',', '.'));
  }
  return null;
}

// Maps UTC offset (−12 … +14) to a hue on the color wheel: blue in the west,
// cycling through cyan → green → yellow → orange → red in the east.
function zoneColor(utcHours: number, alpha: number): Cesium.Color {
  const t = Math.max(0, Math.min(1, (utcHours + 12) / 26)); // 0=UTC-12, 1=UTC+14
  const hDeg = (1 - t) * 240; // 240° (blue) → 0° (red), no wrap-around
  const s = 0.72;
  const l = 0.50;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hDeg / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hDeg < 60)       { r = c; g = x; b = 0; }
  else if (hDeg < 120) { r = x; g = c; b = 0; }
  else if (hDeg < 180) { r = 0; g = c; b = x; }
  else                 { r = 0; g = x; b = c; }
  return new Cesium.Color(r + m, g + m, b + m, alpha);
}

// UTC offset → "UTC+5" / "UTC-3:30" label string.
function offsetLabel(offset: number): string {
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const h = Math.trunc(abs);
  const m = Math.round((abs - h) * 60);
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`;
}

// Current wall-clock time in a given UTC offset, returned as HH:MM:SS.
function currentTimeAt(utcHours: number): string {
  const now = Date.now();
  const offsetMs = utcHours * 3_600_000;
  // Compute UTC milliseconds, then shift by the zone's offset.
  const d = new Date(now + new Date().getTimezoneOffset() * 60_000 + offsetMs);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function TimeZonesLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.timezones);
  const dsRef = useRef<Cesium.GeoJsonDataSource | null>(null);

  useEffect(() => {
    const setStatus = useTimeZonesStatus.getState().setStatus;
    if (!viewer) return;

    if (!active) {
      if (dsRef.current) {
        viewer.dataSources.remove(dsRef.current, true);
        dsRef.current = null;
      }
      setStatus({ loading: false, ready: false, count: 0, error: null });
      viewer.scene.requestRender();
      return;
    }

    // Already loaded — just re-show it (dataSources.add happened on first activation).
    if (dsRef.current) return;

    setStatus({ loading: true, error: null });
    let mounted = true;

    Cesium.GeoJsonDataSource.load(DATA_URL, {
      stroke: Cesium.Color.WHITE.withAlpha(0.20),
      strokeWidth: 0.8,
      fill: Cesium.Color.TRANSPARENT, // overridden per entity below
      clampToGround: false,
    })
      .then((ds) => {
        if (!mounted) { return; }

        let count = 0;
        for (const entity of ds.entities.values) {
          if (!entity.polygon) continue;

          const props = entity.properties?.getValue(
            Cesium.JulianDate.now()
          ) as Record<string, unknown> | undefined;
          const offset = props ? parseOffset(props) : null;

          const fill = offset !== null
            ? zoneColor(offset, 0.22)
            : new Cesium.Color(0.4, 0.4, 0.4, 0.10);
          const outline = offset !== null
            ? zoneColor(offset, 0.55)
            : Cesium.Color.WHITE.withAlpha(0.18);

          entity.polygon.material = new Cesium.ColorMaterialProperty(fill) as unknown as Cesium.MaterialProperty;
          entity.polygon.outlineColor = new Cesium.ConstantProperty(outline);
          entity.polygon.outline = new Cesium.ConstantProperty(true);
          entity.polygon.outlineWidth = new Cesium.ConstantProperty(1);
          entity.polygon.height = new Cesium.ConstantProperty(0);

          if (offset !== null) {
            const label = offsetLabel(offset);
            const time = currentTimeAt(offset);
            const tzName =
              (props?.['TZ_NAME1ST'] as string | undefined) ??
              (props?.['time_zone'] as string | undefined) ??
              label;
            entity.name = label;
            entity.description = new Cesium.ConstantProperty(`
              <div style="font-family:monospace;padding:4px 0;line-height:1.6">
                <div style="font-size:15px;font-weight:bold;margin-bottom:4px">${label}</div>
                <div><span style="color:#aaa">Current time</span> &nbsp;${time}</div>
                ${tzName !== label ? `<div><span style="color:#aaa">Zone</span> &nbsp;${tzName}</div>` : ''}
              </div>
            `);
          }

          count++;
        }

        dsRef.current = ds;
        viewer.dataSources.add(ds);
        setStatus({ loading: false, ready: true, count, error: null });
        viewer.scene.requestRender();
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setStatus({ loading: false, error: `Timezones: ${msg}` });
      });

    return () => { mounted = false; };
  }, [viewer, active]);

  return null;
}
