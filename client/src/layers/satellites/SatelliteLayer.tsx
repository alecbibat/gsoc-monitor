import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLong,
  degreesLat,
  type SatRec,
  type EciVec3,
} from 'satellite.js';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { usePanelStore } from '../../panels/panelStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { api } from '../../api/client';
import { useSatellitesStatus } from './satellitesStore';
import type { SatelliteGroup } from '../../types';

// Per-group styling — colour tints the satellite glyph and orbit ring; size is
// the billboard footprint (Starlink is tiny because there are thousands of them).
const GROUP_STYLE: Record<SatelliteGroup, { color: string; size: number }> = {
  stations: { color: '#5ef0ff', size: 30 },
  visual: { color: '#ffe14d', size: 20 },
  gps: { color: '#7ee787', size: 22 },
  weather: { color: '#b48cff', size: 22 },
  starlink: { color: '#ff9d4d', size: 13 },
};

const MAX_SATS = 2500; // hard cap so a huge constellation can't swamp the GPU
const LABEL_MAX = 40; // only show name labels for small, legible groups
const ORBIT_SAMPLES = 160; // points sampled across one orbital period
const ORBIT_REFRESH_MS = 8_000; // recompute the selected orbit as Earth rotates

const hex = (s: string) => Cesium.Color.fromCssColorString(s);

// Refresh cadence scales with the satellite count: small groups step fast and
// smooth, huge ones step slower to keep the per-tick propagation cost bounded.
function tickMsFor(n: number): number {
  if (n > 800) return 1500;
  if (n > 200) return 800;
  return 250;
}

// A small satellite glyph (body + solar wings + dish), tinted per group and
// cached by colour so we build each data URI only once.
const ICON_CACHE = new Map<string, string>();
function satIcon(color: string): string {
  const cached = ICON_CACHE.get(color);
  if (cached) return cached;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<g stroke="#091420" stroke-width="2" stroke-linejoin="round">` +
    `<rect x="1" y="25" width="20" height="14" rx="1.5" fill="${color}"/>` +
    `<rect x="43" y="25" width="20" height="14" rx="1.5" fill="${color}"/>` +
    `</g>` +
    `<g stroke="#091420" stroke-width="1" opacity="0.55">` +
    `<line x1="8" y1="25" x2="8" y2="39"/><line x1="14" y1="25" x2="14" y2="39"/>` +
    `<line x1="50" y1="25" x2="50" y2="39"/><line x1="56" y1="25" x2="56" y2="39"/>` +
    `</g>` +
    `<g stroke="#091420" stroke-width="2" stroke-linejoin="round">` +
    `<rect x="21" y="30" width="6" height="4" fill="#c7d4e0"/>` +
    `<rect x="37" y="30" width="6" height="4" fill="#c7d4e0"/>` +
    `<rect x="25" y="23" width="14" height="18" rx="2.5" fill="#eef3f8"/>` +
    `<circle cx="32" cy="17" r="4.5" fill="#eef3f8"/>` +
    `</g>` +
    `</svg>`;
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  ICON_CACHE.set(color, uri);
  return uri;
}

interface SatRecord {
  name: string;
  satnum: string;
  intlDesig: string;
  satrec: SatRec;
  entity: Cesium.Entity;
}

export function SatelliteLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.satellites);
  const group = useLayersStore((s) => s.satelliteGroup);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('satellites');
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
      useSatellitesStatus.getState().setStatus({ loading: false, count: 0, total: 0, error: null });
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;
    const style = GROUP_STYLE[group];
    const icon = satIcon(style.color);
    const ringColor = hex(style.color).withAlpha(0.85);

    const sats: SatRecord[] = [];
    const byId = new Map<string, SatRecord>();

    // --- Selected-satellite orbit ring ---------------------------------------
    let orbitEntity: Cesium.Entity | null = null;
    let orbitSatnum: string | null = null;
    let orbitAt = 0;

    const clearOrbit = () => {
      if (orbitEntity) ds.entities.remove(orbitEntity);
      orbitEntity = null;
      orbitSatnum = null;
    };

    // Sample one full revolution from now and draw the real 3D orbital path
    // (the near half renders in front of the globe, the far half is occluded).
    const computeOrbit = (satrec: SatRec): Cesium.Cartesian3[] => {
      const periodMin = (2 * Math.PI) / satrec.no;
      const startMs = Date.now();
      const pts: Cesium.Cartesian3[] = [];
      for (let i = 0; i <= ORBIT_SAMPLES; i++) {
        const t = new Date(startMs + periodMin * 60_000 * (i / ORBIT_SAMPLES));
        const pv = propagate(satrec, t);
        if (typeof pv.position === 'boolean') continue;
        const geo = eciToGeodetic(pv.position as EciVec3<number>, gstime(t));
        pts.push(
          Cesium.Cartesian3.fromDegrees(
            degreesLong(geo.longitude),
            degreesLat(geo.latitude),
            geo.height * 1000
          )
        );
      }
      return pts;
    };

    const drawOrbit = (rec: SatRecord) => {
      if (orbitEntity) ds.entities.remove(orbitEntity);
      orbitEntity = ds.entities.add({
        polyline: {
          positions: computeOrbit(rec.satrec),
          width: 2,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color: ringColor }),
        },
      });
      orbitSatnum = rec.satnum;
      orbitAt = performance.now();
    };

    // Which satellite's panel is on top (if any) — that's the one we ring.
    const selectedSatnum = (): string | null => {
      const panels = usePanelStore.getState().panels.filter((p) => p.kind === 'satellites');
      if (!panels.length) return null;
      const top = panels.reduce((a, b) => (b.z > a.z ? b : a));
      return top.id.startsWith('sat-') ? top.id.slice(4) : null;
    };

    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      const now = new Date();
      const g = gstime(now);
      for (const s of sats) {
        const pv = propagate(s.satrec, now);
        if (typeof pv.position === 'boolean') {
          s.entity.show = false;
          continue;
        }
        const geo = eciToGeodetic(pv.position as EciVec3<number>, g);
        const lon = degreesLong(geo.longitude);
        const lat = degreesLat(geo.latitude);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
          s.entity.show = false;
          continue;
        }
        s.entity.show = true;
        (s.entity.position as Cesium.ConstantPositionProperty).setValue(
          Cesium.Cartesian3.fromDegrees(lon, lat, geo.height * 1000)
        );
      }

      // Keep the orbit ring in sync with the current selection.
      const sel = selectedSatnum();
      if (!sel || !byId.has(sel)) {
        if (orbitEntity) clearOrbit();
      } else if (sel !== orbitSatnum || performance.now() - orbitAt > ORBIT_REFRESH_MS) {
        drawOrbit(byId.get(sel)!);
      }

      viewer.scene.requestRender();
    };

    const load = async () => {
      useSatellitesStatus.getState().setStatus({ loading: true, error: null });
      try {
        const data = await api.satellites(group);
        if (cancelled) return;

        ds.entities.removeAll();
        sats.length = 0;
        byId.clear();
        orbitEntity = null;
        orbitSatnum = null;

        const total = data.satellites.length;
        const visible = data.satellites.slice(0, MAX_SATS);
        const showLabels = visible.length <= LABEL_MAX;

        for (const tle of visible) {
          let satrec: SatRec;
          try {
            satrec = twoline2satrec(tle.line1, tle.line2);
          } catch {
            continue;
          }
          const entity = ds.entities.add({
            id: `sat-${tle.satnum}`,
            position: new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromDegrees(0, 0, 0)),
            show: false, // revealed once the first propagation places it
            billboard: {
              image: icon,
              width: style.size,
              height: style.size,
              // Default depth test so satellites on the far side of the planet
              // are correctly hidden behind the globe.
            },
            label: showLabels
              ? {
                  text: tle.name,
                  font: '600 11px Inter, system-ui, sans-serif',
                  fillColor: hex('#dbe7f2'),
                  outlineColor: hex('#04121c'),
                  outlineWidth: 3,
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  pixelOffset: new Cesium.Cartesian2(0, -16),
                  verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                  scaleByDistance: new Cesium.NearFarScalar(1.5e6, 1.0, 2.0e7, 0.55),
                }
              : undefined,
          });
          attachPanelData(entity, {
            id: `sat-${tle.satnum}`,
            kind: 'satellites',
            title: tle.name,
            subtitle: `NORAD ${tle.satnum}${tle.intlDesig ? ` · ${tle.intlDesig}` : ''}`,
            payload: {
              name: tle.name,
              satnum: tle.satnum,
              intlDesig: tle.intlDesig,
              line1: tle.line1,
              line2: tle.line2,
              group,
            },
          });
          const rec: SatRecord = {
            name: tle.name,
            satnum: tle.satnum,
            intlDesig: tle.intlDesig,
            satrec,
            entity,
          };
          sats.push(rec);
          byId.set(tle.satnum, rec);
        }

        useSatellitesStatus.getState().setStatus({
          loading: false,
          count: sats.length,
          total,
          error: null,
        });

        tick(); // place everything immediately, then keep stepping
        timer = setInterval(tick, tickMsFor(sats.length));
        viewer.scene.requestRender();
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load satellites', err);
        useSatellitesStatus
          .getState()
          .setStatus({ loading: false, count: 0, error: 'Satellite feed unavailable' });
      }
    };

    load();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      ds.entities.removeAll();
    };
  }, [viewer, active, group]);

  return null;
}
