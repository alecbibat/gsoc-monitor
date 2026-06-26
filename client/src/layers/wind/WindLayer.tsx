import * as Cesium from 'cesium';
import { useEffect } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { api } from '../../api/client';
import { useWindStatus } from './windStore';
import type { WindGrid } from '../../types';

// --- Tuning -----------------------------------------------------------------

const PARTICLE_COUNT = 7000;
// Particle lifetime, in animation ticks. A spread of lifetimes (and a fade in/
// out within each) keeps the field shimmering rather than pulsing in lockstep.
const LIFE_MIN = 50;
const LIFE_MAX = 170;
// Degrees of travel per (m/s) per tick. The field is real but globe-scale
// surface wind would crawl imperceptibly, so motion is exaggerated; this value
// gives lively-but-readable streaks (a 10 m/s breeze ≈ 0.05°/tick).
const STEP_DEG_PER_MS = 0.0052;
// Trim particles that wander into the polar cap where the grid stops and the
// 1/cos(lat) longitude term explodes.
const LAT_LIMIT = 84;
// A few km of lift so near-side particles sit cleanly in front of the ellipsoid
// (no z-fighting) while far-side ones stay hidden behind the globe — the depth
// test does the 3D occlusion, the lift just breaks the surface tie.
const PARTICLE_ALT_M = 3000;
const POINT_SIZE = 2.4;
// ~33 ms → cap the animation near 30 fps. Smooth enough for flowing wind and
// noticeably kinder to weak GPUs than rendering every vsync.
const FRAME_MS = 33;

// Speed → color ramp (m/s). Calm blues through green/yellow to hot reds for the
// jet — a compact, legible wind palette.
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

// Write the speed-ramp color into `out` (reused scratch — no per-particle alloc).
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

// Bilinear sampler over the grid. Longitude wraps (column nx → column 0);
// returns null outside the covered latitude band.
function makeSampler(grid: WindGrid) {
  const { nx, ny, lon0, lat0, dLon, dLat, u, v } = grid;
  return (lon: number, lat: number, out: [number, number]): boolean => {
    let x = (lon - lon0) / dLon;
    x = ((x % nx) + nx) % nx; // wrap into [0, nx)
    const y = (lat - lat0) / dLat;
    if (y < 0 || y > ny - 1) return false;
    const x0 = Math.floor(x);
    const x1 = (x0 + 1) % nx;
    const y0 = Math.floor(y);
    const y1 = Math.min(y0 + 1, ny - 1);
    const fx = x - x0;
    const fy = y - y0;
    const i00 = y0 * nx + x0;
    const i10 = y0 * nx + x1;
    const i01 = y1 * nx + x0;
    const i11 = y1 * nx + x1;
    const u0 = u[i00] + (u[i10] - u[i00]) * fx;
    const u1 = u[i01] + (u[i11] - u[i01]) * fx;
    const v0 = v[i00] + (v[i10] - v[i00]) * fx;
    const v1 = v[i01] + (v[i11] - v[i01]) * fx;
    out[0] = u0 + (u1 - u0) * fy;
    out[1] = v0 + (v1 - v0) * fy;
    return true;
  };
}

interface Particle {
  lon: number;
  lat: number;
  age: number;
  life: number;
}

function randomizeParticle(p: Particle): void {
  p.lon = Math.random() * 360 - 180;
  p.lat = Math.random() * 2 * (LAT_LIMIT - 4) - (LAT_LIMIT - 4);
  p.age = 0;
  p.life = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
}

export function WindLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.wind);

  useEffect(() => {
    if (!viewer || !active) return;
    const v = viewer;
    let cancelled = false;

    const points = v.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    const particles: Particle[] = [];
    const handles: Cesium.PointPrimitive[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p: Particle = { lon: 0, lat: 0, age: 0, life: 0 };
      randomizeParticle(p);
      p.age = Math.random() * p.life; // stagger so they don't all respawn together
      particles.push(p);
      handles.push(
        points.add({
          position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, PARTICLE_ALT_M),
          pixelSize: POINT_SIZE,
          color: Cesium.Color.TRANSPARENT,
          // Default depth test → particles behind the globe are occluded (the
          // whole point of doing this in 3D). No disableDepthTestDistance.
        })
      );
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
        const handle = handles[i];

        if (p.age >= p.life || !sample(p.lon, p.lat, wind)) {
          randomizeParticle(p);
          handle.show = false;
          continue;
        }

        const u = wind[0];
        const vv = wind[1];
        const spd = Math.hypot(u, vv);
        // Move along the wind. Longitude degrees shrink toward the poles, so
        // divide by cos(lat) (clamped) to keep the heading true on the sphere.
        const cosLat = Math.max(0.25, Math.cos((p.lat * Math.PI) / 180));
        p.lon += (u * STEP_DEG_PER_MS) / cosLat;
        p.lat += vv * STEP_DEG_PER_MS;
        p.age += 1;

        if (p.lon > 180) p.lon -= 360;
        else if (p.lon < -180) p.lon += 360;

        if (p.lat > LAT_LIMIT || p.lat < -LAT_LIMIT) {
          randomizeParticle(p);
          handle.show = false;
          continue;
        }

        // Fade in over the first fifth of life, out over the last quarter, so
        // particles appear and vanish softly instead of popping.
        const f = p.age / p.life;
        const fade = f < 0.2 ? f / 0.2 : f > 0.75 ? (1 - f) / 0.25 : 1;

        // Assign through the setters (not by mutating the getter result) so the
        // collection flags the point dirty and re-uploads it.
        handle.position = Cesium.Cartesian3.fromDegrees(
          p.lon,
          p.lat,
          PARTICLE_ALT_M,
          undefined,
          scratchCart
        );
        speedColor(spd, scratch);
        scratch.alpha = Math.max(0, Math.min(1, fade)) * 0.9;
        handle.color = scratch;
        handle.show = true;
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

    const loadGrid = async () => {
      try {
        const grid = await api.wind();
        if (cancelled) return;
        sample = makeSampler(grid);
        useWindStatus.getState().setStatus({
          ready: true,
          error: null,
          maxSpeedMps: grid.speedMax,
        });
        if (rafId == null) rafId = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load wind grid', err);
        useWindStatus.getState().setStatus({ error: 'Wind feed unavailable' });
      }
    };

    loadGrid();
    // Refresh the field periodically; particles keep flowing on the old one
    // until the new grid swaps in.
    const interval = setInterval(loadGrid, 30 * 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (rafId != null) cancelAnimationFrame(rafId);
      v.scene.primitives.remove(points); // destroys the collection + its points
      useWindStatus.getState().setStatus({ ready: false, error: null, maxSpeedMps: 0 });
      v.scene.requestRender();
    };
  }, [viewer, active]);

  return null;
}
