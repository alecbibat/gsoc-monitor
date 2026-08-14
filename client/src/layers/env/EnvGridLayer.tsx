import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import type { EnvGridResponse } from '../../types';
import { contourLevels, contourLines, type ScalarGrid } from './marchingSquares';
import { useEnvStore, type EnvField } from './envStore';

// ── Environmental overlays (Track 4): isobars + surface temp/RH raster ───────
// Both read the server's 1.25° CONUS grid (/api/envgrid). Isobars are
// marching-squares contours at 4 hPa drawn as polylines with pressure labels;
// the field overlay is a bilinearly-interpolated colormapped canvas draped
// over the grid extent as a single imagery tile.

const GRID_TTL_MS = 15 * 60_000;
const ISOBAR_INTERVAL_HPA = 4;

// Shared fetch between the two toggles — one request feeds both.
let cached: { grid: EnvGridResponse; at: number } | null = null;
let inflight: Promise<EnvGridResponse> | null = null;
async function getGrid(): Promise<EnvGridResponse> {
  if (cached && Date.now() - cached.at < GRID_TTL_MS) return cached.grid;
  if (!inflight) {
    inflight = api
      .envGrid()
      .then((g) => {
        cached = { grid: g, at: Date.now() };
        return g;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

const ageText = (updated: number) => {
  const min = Math.max(0, Math.round((Date.now() - updated) / 60_000));
  return min < 60 ? `${min}m ago` : `${Math.floor(min / 60)}h ${min % 60}m ago`;
};

// ── Colormaps (linear interpolation between stops) ───────────────────────────

type Stop = [number, [number, number, number]];

const TEMP_STOPS: Stop[] = [
  [-30, [49, 54, 149]], [-20, [69, 117, 180]], [-10, [116, 173, 209]],
  [0, [171, 217, 233]], [5, [224, 243, 248]], [10, [255, 255, 191]],
  [15, [254, 224, 144]], [20, [253, 174, 97]], [25, [244, 109, 67]],
  [30, [215, 48, 39]], [40, [165, 0, 38]],
];

const RH_STOPS: Stop[] = [
  [0, [140, 81, 10]], [20, [191, 129, 45]], [40, [223, 194, 125]],
  [60, [199, 234, 229]], [80, [90, 180, 172]], [100, [1, 102, 94]],
];

function colorAt(stops: Stop[], v: number): [number, number, number] {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [v0, c0] = stops[i - 1];
      const [v1, c1] = stops[i];
      const t = (v - v0) / (v1 - v0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

// Bilinear sample of a (nullable) grid field at fractional grid coordinates.
function sample(values: (number | null)[], nx: number, fx: number, fy: number): number | null {
  const c = Math.floor(fx);
  const r = Math.floor(fy);
  const v00 = values[r * nx + c];
  const v10 = values[r * nx + c + 1] ?? v00;
  const v01 = values[(r + 1) * nx + c] ?? v00;
  const v11 = values[(r + 1) * nx + c + 1] ?? v00;
  if (v00 === null || v10 === null || v01 === null || v11 === null) return null;
  const tx = fx - c;
  const ty = fy - r;
  return (
    v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) +
    v01 * (1 - tx) * ty + v11 * tx * ty
  );
}

function renderFieldCanvas(grid: EnvGridResponse, field: EnvField): HTMLCanvasElement {
  const values = field === 'temp' ? grid.tempC : grid.rhPct;
  const stops = field === 'temp' ? TEMP_STOPS : RH_STOPS;
  const SCALE = 16;
  const w = (grid.nx - 1) * SCALE;
  const h = (grid.ny - 1) * SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    // Canvas rows go top→down; grid rows go south→north.
    const fy = (1 - y / (h - 1)) * (grid.ny - 1 - 1e-9);
    for (let x = 0; x < w; x++) {
      const fx = (x / (w - 1)) * (grid.nx - 1 - 1e-9);
      const v = sample(values, grid.nx, fx, fy);
      const o = (y * w + x) * 4;
      if (v === null) { img.data[o + 3] = 0; continue; }
      const [r, g, b] = colorAt(stops, v);
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b;
      img.data[o + 3] = 150; // ~0.59 — terrain and labels stay readable
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function gridRectangle(grid: EnvGridResponse): Cesium.Rectangle {
  return Cesium.Rectangle.fromDegrees(
    grid.lon0,
    grid.lat0,
    grid.lon0 + grid.dLon * (grid.nx - 1),
    grid.lat0 + grid.dLat * (grid.ny - 1)
  );
}

export function EnvGridLayer() {
  const viewer = useCesiumViewer();
  const isobarsActive = useLayersStore((s) => s.active.isobars);
  const fieldActive = useLayersStore((s) => s.active.envField);
  const field = useEnvStore((s) => s.field);
  const isobarDsRef = useRef<Cesium.CustomDataSource | null>(null);
  const fieldLayerRef = useRef<Cesium.ImageryLayer | null>(null);

  // Isobars — contour the MSL pressure field at 4 hPa.
  useEffect(() => {
    if (!viewer) return;
    let cancelled = false;
    const setStatus = useEnvStore.getState().setStatus;

    if (!isobarsActive) {
      if (isobarDsRef.current) {
        viewer.dataSources.remove(isobarDsRef.current, true);
        isobarDsRef.current = null;
        viewer.scene.requestRender();
      }
      return;
    }

    getGrid()
      .then((grid) => {
        if (cancelled || !viewer || viewer.isDestroyed()) return;
        const ds = new Cesium.CustomDataSource('isobars');
        const sgrid: ScalarGrid = { ...grid, values: grid.mslHpa };
        for (const level of contourLevels(grid.mslHpa, ISOBAR_INTERVAL_HPA)) {
          for (const line of contourLines(sgrid, level)) {
            if (line.length < 2) continue;
            ds.entities.add({
              polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray(line.flat()),
                width: 1.5,
                material: Cesium.Color.WHITE.withAlpha(0.55),
                clampToGround: false,
              },
            });
            const mid = line[Math.floor(line.length / 2)];
            ds.entities.add({
              position: Cesium.Cartesian3.fromDegrees(mid[0], mid[1]),
              label: {
                text: String(level),
                font: '11px Inter, sans-serif',
                fillColor: Cesium.Color.WHITE.withAlpha(0.85),
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString('#0a0e14').withAlpha(0.65),
                backgroundPadding: new Cesium.Cartesian2(4, 2),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                scaleByDistance: new Cesium.NearFarScalar(1e6, 1, 1.2e7, 0.6),
              },
            });
          }
        }
        void viewer.dataSources.add(ds);
        isobarDsRef.current = ds;
        setStatus(`MSL pressure · 4 hPa isobars · updated ${ageText(grid.updated)}${grid.stale ? ' (stale)' : ''}`);
        viewer.scene.requestRender();
      })
      .catch((e) => { if (!cancelled) setStatus(`grid unavailable (${(e as Error).message})`); });

    return () => {
      cancelled = true;
      if (isobarDsRef.current) {
        viewer.dataSources.remove(isobarDsRef.current, true);
        isobarDsRef.current = null;
        viewer.scene.requestRender();
      }
    };
  }, [viewer, isobarsActive]);

  // Field raster — temp or RH draped over the grid extent.
  useEffect(() => {
    if (!viewer) return;
    let cancelled = false;
    const setStatus = useEnvStore.getState().setStatus;

    if (!fieldActive) {
      if (fieldLayerRef.current) {
        viewer.imageryLayers.remove(fieldLayerRef.current, true);
        fieldLayerRef.current = null;
        viewer.scene.requestRender();
      }
      return;
    }

    getGrid()
      .then((grid) => {
        if (cancelled || !viewer || viewer.isDestroyed()) return;
        const canvas = renderFieldCanvas(grid, field);
        const provider = new Cesium.SingleTileImageryProvider({
          url: canvas.toDataURL('image/png'),
          rectangle: gridRectangle(grid),
          tileWidth: canvas.width,
          tileHeight: canvas.height,
        });
        const layer = viewer.imageryLayers.addImageryProvider(provider);
        fieldLayerRef.current = layer;
        setStatus(
          `${field === 'temp' ? 'Surface temperature' : 'Relative humidity'} · updated ${ageText(grid.updated)}${grid.stale ? ' (stale)' : ''}`
        );
        viewer.scene.requestRender();
      })
      .catch((e) => { if (!cancelled) setStatus(`grid unavailable (${(e as Error).message})`); });

    return () => {
      cancelled = true;
      if (fieldLayerRef.current) {
        viewer.imageryLayers.remove(fieldLayerRef.current, true);
        fieldLayerRef.current = null;
        viewer.scene.requestRender();
      }
    };
  }, [viewer, fieldActive, field]);

  return null;
}
