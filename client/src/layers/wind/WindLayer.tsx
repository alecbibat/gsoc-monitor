import * as Cesium from 'cesium';
import { useEffect } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { useWindStatus } from './windStore';
import { makeSampler } from './windProbe';
import type { WindGrid } from '../../types';

// The last fetched grid, cached in localStorage (~80 KB) so the field renders
// the instant the layer mounts — even on a fresh page load or with the server
// unreachable — and the network fetch swaps in fresh data seamlessly behind it.
const GRID_CACHE_KEY = 'gsoc-wind-grid';

function readCachedGrid(): WindGrid | null {
  try {
    const raw = localStorage.getItem(GRID_CACHE_KEY);
    if (!raw) return null;
    const grid = JSON.parse(raw) as WindGrid;
    return grid?.u?.length ? grid : null;
  } catch {
    return null;
  }
}

function writeCachedGrid(grid: WindGrid): void {
  try {
    localStorage.setItem(GRID_CACHE_KEY, JSON.stringify(grid));
  } catch {
    // Quota/private-mode — the server snapshot still covers reloads.
  }
}

// --- Tuning -----------------------------------------------------------------

const PARTICLE_COUNT = 7000;
// Particle lifetime, in animation ticks. A spread of lifetimes (and a fade in/
// out within each) keeps the field shimmering rather than pulsing in lockstep.
const LIFE_MIN = 50;
const LIFE_MAX = 170;
// Degrees of travel per (m/s) per tick.
const STEP_DEG_PER_MS = 0.0052;
// Trim particles that wander into the polar cap.
const LAT_LIMIT = 84;
// A few km of lift so particles sit cleanly above the ellipsoid.
const PARTICLE_ALT_M = 3000;
const POINT_SIZE = 2.4;
// ~33 ms → cap near 30 fps.
const FRAME_MS = 33;

// Trail: each particle keeps a ring buffer of past positions rendered as
// progressively smaller, dimmer points behind the head — making the direction
// of flow easy to read at a glance.
const TRAIL_LEN = 8;
// Alpha of the head particle at peak fade. Each trail slot is this fraction
// dimmer than the one in front of it.
const HEAD_ALPHA = 0.9;
const TRAIL_FALLOFF = 0.62;
// Minimum pixel size for the oldest trail segment.
const TRAIL_SIZE_MIN = 1.0;

// Speed → color ramp (m/s). Calm blues through green/yellow to hot reds.
const RAMP: Array<[number, Cesium.Color]> = [
  [0, Cesium.Color.fromCssColorString('#3b4cc0')],
  [4, Cesium.Color.fromCssColorString('#2a9d8f')],
  [8, Cesium.Color.fromCssColorString('#2bb673')],
  [12, Cesium.Color.fromCssColorString('#a7c957')],
  [16, Cesium.Color.fromCssColorString('#f4d35e')],
  [22, Cesium.Color.fromCssColorString('#ee964b')],
  [30, Cesium.Color.fromCssColorString('#e63946')],
  [45, Cesium.Color.fromCssColorString('#d6336c')],
];

function speedColor(spd: number, out: Cesium.Color): Cesium.Color {
  if (spd <= RAMP[0][0]) return Cesium.Color.clone(RAMP[0][1], out);
  const last = RAMP[RAMP.length - 1];
  if (spd >= last[0]) return Cesium.Color.clone(last[1], out);
  for (let i = 1; i < RAMP.length; i++) {
    if (spd < RAMP[i][0]) {
      const [s0, c0] = RAMP[i - 1];
      const [s1, c1] = RAMP[i];
      const t = (spd - s0) / (s1 - s0);
      out.red = c0.red + (c1.red - c0.red) * t;
      out.green = c0.green + (c1.green - c0.green) * t;
      out.blue = c0.blue + (c1.blue - c0.blue) * t;
      out.alpha = 1;
      return out;
    }
  }
  return Cesium.Color.clone(last[1], out);
}

interface Particle {
  lon: number;
  lat: number;
  age: number;
  life: number;
  // Ring buffer of past positions (lon/lat before each step).
  trailLons: Float32Array;
  trailLats: Float32Array;
  trailHead: number; // index of next write slot
  trailFill: number; // how many slots have valid data (0..TRAIL_LEN)
}

function randomizeParticle(p: Particle): void {
  p.lon = Math.random() * 360 - 180;
  p.lat = Math.random() * 2 * (LAT_LIMIT - 4) - (LAT_LIMIT - 4);
  p.age = 0;
  p.life = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
  p.trailHead = 0;
  p.trailFill = 0;
}

export function WindLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.wind);

  useEffect(() => {
    if (!viewer || !active) return;
    const v = viewer;
    let cancelled = false;

    const points = v.scene.primitives.add(new Cesium.PointPrimitiveCollection());

    // Allocate head handles + trail handles in one flat collection.
    // Layout: heads[0..PARTICLE_COUNT), then trail segments interleaved:
    //   trail slot j of particle i → index PARTICLE_COUNT + i * TRAIL_LEN + j
    //   j=0 is the most recent position (one tick ago), j=TRAIL_LEN-1 is oldest.
    const particles: Particle[] = [];
    const headHandles: Cesium.PointPrimitive[] = [];
    const trailHandles: Cesium.PointPrimitive[] = [];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p: Particle = {
        lon: 0,
        lat: 0,
        age: 0,
        life: 0,
        trailLons: new Float32Array(TRAIL_LEN),
        trailLats: new Float32Array(TRAIL_LEN),
        trailHead: 0,
        trailFill: 0,
      };
      randomizeParticle(p);
      p.age = Math.random() * p.life; // stagger so they don't all respawn together
      particles.push(p);

      headHandles.push(
        points.add({
          position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, PARTICLE_ALT_M),
          pixelSize: POINT_SIZE,
          color: Cesium.Color.TRANSPARENT,
        })
      );

      for (let j = 0; j < TRAIL_LEN; j++) {
        // Pre-size: smaller & dimmer for older slots.
        const size = Math.max(TRAIL_SIZE_MIN, POINT_SIZE - (j + 1) * 0.15);
        trailHandles.push(
          points.add({
            position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, PARTICLE_ALT_M),
            pixelSize: size,
            color: Cesium.Color.TRANSPARENT,
          })
        );
      }
    }

    let sample: ((lon: number, lat: number, out: [number, number]) => boolean) | null = null;
    let rafId: number | null = null;
    let lastFrame = 0;

    const wind: [number, number] = [0, 0];
    const scratch = new Cesium.Color();
    const scratchCart = new Cesium.Cartesian3();

    const update = () => {
      if (!sample) return;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const head = headHandles[i];

        if (p.age >= p.life || !sample(p.lon, p.lat, wind)) {
          // Reset particle and wipe all trail segments.
          randomizeParticle(p);
          head.show = false;
          for (let j = 0; j < TRAIL_LEN; j++) {
            trailHandles[i * TRAIL_LEN + j].show = false;
          }
          continue;
        }

        const u = wind[0];
        const vv = wind[1];
        const spd = Math.hypot(u, vv);

        // Record current position into trail ring buffer before moving.
        p.trailLons[p.trailHead] = p.lon;
        p.trailLats[p.trailHead] = p.lat;
        p.trailHead = (p.trailHead + 1) % TRAIL_LEN;
        p.trailFill = Math.min(p.trailFill + 1, TRAIL_LEN);

        // Move along the wind.
        const cosLat = Math.max(0.25, Math.cos((p.lat * Math.PI) / 180));
        p.lon += (u * STEP_DEG_PER_MS) / cosLat;
        p.lat += vv * STEP_DEG_PER_MS;
        p.age += 1;

        if (p.lon > 180) p.lon -= 360;
        else if (p.lon < -180) p.lon += 360;

        if (p.lat > LAT_LIMIT || p.lat < -LAT_LIMIT) {
          randomizeParticle(p);
          head.show = false;
          for (let j = 0; j < TRAIL_LEN; j++) {
            trailHandles[i * TRAIL_LEN + j].show = false;
          }
          continue;
        }

        // Fade in over the first fifth of life, out over the last quarter.
        const f = p.age / p.life;
        const fade = f < 0.2 ? f / 0.2 : f > 0.75 ? (1 - f) / 0.25 : 1;

        // Update head.
        head.position = Cesium.Cartesian3.fromDegrees(
          p.lon,
          p.lat,
          PARTICLE_ALT_M,
          undefined,
          scratchCart
        );
        speedColor(spd, scratch);
        scratch.alpha = Math.max(0, Math.min(1, fade)) * HEAD_ALPHA;
        head.color = scratch;
        head.show = true;

        // Update trail segments. j=0 is most recent, j=TRAIL_LEN-1 is oldest.
        for (let j = 0; j < TRAIL_LEN; j++) {
          const th = trailHandles[i * TRAIL_LEN + j];
          if (j >= p.trailFill) {
            th.show = false;
            continue;
          }
          // Ring-buffer read: slot j steps behind the last written entry.
          const rIdx = ((p.trailHead - 1 - j) % TRAIL_LEN + TRAIL_LEN) % TRAIL_LEN;
          th.position = Cesium.Cartesian3.fromDegrees(
            p.trailLons[rIdx],
            p.trailLats[rIdx],
            PARTICLE_ALT_M,
            undefined,
            scratchCart
          );
          speedColor(spd, scratch);
          // Alpha drops off exponentially along the trail.
          const trailAlpha = fade * HEAD_ALPHA * Math.pow(TRAIL_FALLOFF, j + 1);
          scratch.alpha = Math.max(0, trailAlpha);
          th.color = scratch;
          th.show = true;
        }
      }
    };

    const tick = (t: number) => {
      if (cancelled) return;
      rafId = requestAnimationFrame(tick);
      if (t - lastFrame < FRAME_MS) return;
      lastFrame = t;
      update();
      v.scene.requestRender();
    };

    const applyGrid = (grid: WindGrid, stale: boolean) => {
      sample = makeSampler(grid);
      useWindStatus.getState().setStatus({
        ready: true,
        error: null,
        maxSpeedMps: grid.speedMax,
        grid,
        stale,
      });
      if (rafId == null) rafId = requestAnimationFrame(tick);
    };

    // Start the field immediately from the cached grid (if any) — the fetch
    // below replaces it the moment fresh data lands. No blank state, ever.
    const cached = readCachedGrid();
    if (cached) applyGrid(cached, true);

    const loadGrid = async () => {
      try {
        const grid = await api.wind();
        if (cancelled) return;
        applyGrid(grid, grid.stale ?? false);
        writeCachedGrid(grid);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load wind grid', err);
        // Keep animating whatever grid we already have (cached or previous
        // fetch) rather than blanking the field; only surface a hard error when
        // there is truly nothing to show.
        if (useWindStatus.getState().grid) {
          useWindStatus.getState().setStatus({ stale: true, error: null });
        } else {
          useWindStatus.getState().setStatus({ error: 'Wind feed unavailable' });
        }
      }
    };

    loadGrid();
    const interval = setInterval(loadGrid, 30 * 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (rafId != null) cancelAnimationFrame(rafId);
      v.scene.primitives.remove(points);
      useWindStatus.getState().setStatus({ ready: false, error: null, maxSpeedMps: 0, grid: null });
      v.scene.requestRender();
    };
  }, [viewer, active]);

  return null;
}
