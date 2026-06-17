import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { attachPanelData } from '../../cesium/entityPanelLink';
import type { EarthquakeFeature } from '../../types';

// Concentric seismic-ring SVG billboard — 3 ripple rings + epicenter dot,
// color and pixel size keyed on magnitude tier.
type MagTier = 'major' | 'strong' | 'moderate' | 'minor';

function magTier(mag: number): MagTier {
  if (mag >= 6) return 'major';
  if (mag >= 4.5) return 'strong';
  if (mag >= 2.5) return 'moderate';
  return 'minor';
}

const MAG_COLORS: Record<MagTier, { hex: string; size: number }> = {
  major:    { hex: '#ff5d5d', size: 40 },
  strong:   { hex: '#ffb84d', size: 32 },
  moderate: { hex: '#ffe14d', size: 26 },
  minor:    { hex: '#52e3a4', size: 20 },
};

function makeEqSvg(tier: MagTier): string {
  const { hex } = MAG_COLORS[tier];
  // Three concentric ripple rings with decreasing opacity outward, plus a
  // filled center dot marking the epicenter.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">` +
    `<circle cx="20" cy="20" r="17" fill="none" stroke="${hex}" stroke-width="1.5" opacity="0.3"/>` +
    `<circle cx="20" cy="20" r="11.5" fill="none" stroke="${hex}" stroke-width="2" opacity="0.55"/>` +
    `<circle cx="20" cy="20" r="6.5" fill="none" stroke="${hex}" stroke-width="2.5" opacity="0.85"/>` +
    `<circle cx="20" cy="20" r="3" fill="${hex}"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const eqIconCache = new Map<MagTier, string>();
function eqIcon(mag: number): string {
  const tier = magTier(mag);
  if (!eqIconCache.has(tier)) eqIconCache.set(tier, makeEqSvg(tier));
  return eqIconCache.get(tier)!;
}

function eqIconSize(mag: number): number {
  return MAG_COLORS[magTier(mag)].size;
}

export function EarthquakeLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.earthquakes);
  const magnitude = useLayersStore((s) => s.earthquakeMagnitude);
  const period = useLayersStore((s) => s.earthquakePeriod);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('earthquakes');
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
        const data = await api.earthquakes(magnitude, period);
        if (cancelled) return;
        ds.entities.removeAll();
        for (const feature of data.features as unknown as EarthquakeFeature[]) {
          const [lon, lat, depthKm] = feature.geometry.coordinates;
          const mag = feature.properties.mag ?? 0;
          const sz = eqIconSize(mag);
          const entity = ds.entities.add({
            id: `eq-${feature.id}`,
            position: Cesium.Cartesian3.fromDegrees(lon, lat),
            billboard: {
              image: eqIcon(mag),
              width: sz,
              height: sz,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              // Default depth test so quakes on the far side of the globe stay hidden.
            },
          });
          attachPanelData(entity, {
            id: `eq-${feature.id}`,
            kind: 'earthquakes',
            title: `M${mag.toFixed(1)} Earthquake`,
            subtitle: feature.properties.place,
            payload: {
              mag,
              place: feature.properties.place,
              time: feature.properties.time,
              depthKm,
              url: feature.properties.url,
              felt: feature.properties.felt,
              tsunami: feature.properties.tsunami,
              status: feature.properties.status,
            },
          });
        }
        viewer.scene.requestRender();
      } catch (err) {
        console.error('Failed to load earthquakes', err);
      }
    }

    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [viewer, active, magnitude, period]);

  return null;
}
