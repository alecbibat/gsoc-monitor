import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { useLightningStatus } from './lightningStore';

// Blitzortung's community lightning network publishes real-time strikes over a
// set of public WebSocket relays. There's no official API, so we connect to the
// known relays (rotating on failure) and decode their lightly-compressed frames
// the same way the public lightningmaps.org client does.
const RELAYS = [
  'wss://ws1.blitzortung.org/',
  'wss://ws7.blitzortung.org/',
  'wss://ws8.blitzortung.org/',
];

const STRIKE_LIFETIME_MS = 600_000; // how long a flash lingers before fading out (10 min)
const MAX_STRIKES = 2_500; // hard cap so a busy storm can't flood the scene
const TICK_MS = 1_000; // stage-step / cleanup cadence (colours change over seconds, not frames)

// LZW-style decompressor matching Blitzortung's wire format. Frames are JSON
// objects compressed with this scheme; decode then JSON.parse to get a strike.
function inflate(input: string): string {
  const dict: Record<number, string> = {};
  const data = input.split('');
  let current = data[0];
  let oldPhrase = current;
  const out: string[] = [current];
  let code = 256;
  const baseCode = 256;
  for (let i = 1; i < data.length; i++) {
    const charCode = data[i].charCodeAt(0);
    let phrase: string;
    if (baseCode > charCode) {
      phrase = data[i];
    } else {
      phrase = dict[charCode] ? dict[charCode] : oldPhrase + current;
    }
    out.push(phrase);
    current = phrase.charAt(0);
    dict[code] = oldPhrase + current;
    code++;
    oldPhrase = phrase;
  }
  return out.join('');
}

interface Strike {
  lat: number;
  lon: number;
  t: number; // local receive time (ms)
  stage: number; // index into X_STAGES; only repainted when this changes
}

const hex = (s: string) => Cesium.Color.fromCssColorString(s);

// Settled-strike age stages. The crosshair steps through these distinct colours
// at fixed age thresholds instead of continuously lerping on every tick. The
// payoff is load: a strike only needs a billboard update (and a re-render) at
// the moment it crosses a boundary, so a field of thousands of settled strikes
// costs essentially nothing to maintain and the scene is free to idle — which
// matters a lot on a weak GPU. Every strike is the same size; only its colour
// encodes age, stepping white → yellow → orange → red at 3 / 6 / 9 minutes over
// the 10-minute lifetime.
//
// altM is a tiny per-stage altitude lift (metres) so newer strikes draw over
// older ones: a fresh strike sits a few metres higher than an aged one, so when
// two land on the same spot the newer (higher) X wins the depth test. The lift
// is sub-pixel at any real viewing distance — it only breaks the depth tie.
interface XStage {
  untilMs: number; // strike shows this stage while age < untilMs
  color: Cesium.Color;
  altM: number; // altitude lift — higher = drawn on top
}
const X_STAGES: XStage[] = [
  { untilMs: 180_000, color: hex('#ffffff'), altM: 6 }, // 0–3m  fresh: white, on top
  { untilMs: 360_000, color: hex('#ffe14d'), altM: 4 }, // 3–6m  yellow
  { untilMs: 540_000, color: hex('#ff9d2e'), altM: 2 }, // 6–9m  orange
  { untilMs: STRIKE_LIFETIME_MS, color: hex('#ff3b30'), altM: 0 }, // 9–10m red, on bottom
];
function stageForAge(age: number): number {
  for (let i = 0; i < X_STAGES.length; i++) if (age < X_STAGES[i].untilMs) return i;
  return X_STAGES.length - 1;
}

// --- Strike-down animation tuning --------------------------------------------
const BOLT_TOP_M = 120_000; // altitude the leader descends from
const BOLT_DESCEND_MS = 150; // time for the leader to reach the ground
const BOLT_LIFE_MS = 480; // total bolt life (descend + flash-out)
// Impact flash: a fixed-size red circle that pops on the strike point and fades.
// Replaces the old expanding shockwave, whose ring was re-tessellated (49 pts)
// and re-clamped to terrain every frame for every concurrent strike — by far
// the heaviest per-frame cost in a storm. This circle's geometry is built once
// at spawn; only its alpha animates.
const RING_FLASH_MS = 550; // flash duration
const RING_FIXED_M = 12_000; // flash circle radius (constant — no expansion)
const MAX_ANIMS = 80; // concurrent bolt animations (storm safety valve)
const BOLT_COLOR = hex('#f2f9ff'); // blue-white bolt
const RING_COLOR = hex('#ff2a1f'); // red impact flash

// A jagged vertical path from high altitude straight down onto the strike point.
// Top and bottom are anchored on the point; the horizontal wander peaks in the
// middle so it reads as a forking bolt rather than a wobbly line.
function makeBoltPath(lon: number, lat: number): Cesium.Cartesian3[] {
  const SEGMENTS = 9;
  const pts: Cesium.Cartesian3[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const f = i / SEGMENTS; // 0 top -> 1 ground
    const alt = BOLT_TOP_M * (1 - f);
    const taper = Math.sin(f * Math.PI); // 0 at the ends, 1 mid-span
    const amp = 0.07 * taper; // up to ~7.7 km of horizontal wander
    const jx = i === 0 || i === SEGMENTS ? 0 : (Math.random() - 0.5) * amp;
    const jy = i === 0 || i === SEGMENTS ? 0 : (Math.random() - 0.5) * amp;
    pts.push(Cesium.Cartesian3.fromDegrees(lon + jx, lat + jy, alt));
  }
  return pts;
}

// A ground circle of `radiusM` around (lon, lat), built once per strike (not
// per frame) — the impact flash holds a constant radius, so its positions never
// need recomputing.
function circlePositions(lon: number, lat: number, radiusM: number): Cesium.Cartesian3[] {
  const N = 48;
  const dLatM = radiusM / 111_320;
  const dLonM = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const pts: Cesium.Cartesian3[] = [];
  for (let i = 0; i <= N; i++) {
    const ang = (i / N) * 2 * Math.PI;
    pts.push(
      Cesium.Cartesian3.fromDegrees(lon + dLonM * Math.sin(ang), lat + dLatM * Math.cos(ang))
    );
  }
  return pts;
}

// White "X" with a soft glow, drawn once and tinted per-strike via billboard
// colour — Blitzortung-style crosshair rather than a plain dot.
const BOLT_ICON = (() => {
  const x = 'M10 10 L26 26 M26 10 L10 26';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">` +
    `<g fill="none" stroke="#ffffff" stroke-linecap="round">` +
    `<path d="${x}" stroke-width="8" opacity="0.25"/>` +
    `<path d="${x}" stroke-width="3.5"/>` +
    `</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
})();

export function LightningLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.lightning);
  const dsRef = useRef<Cesium.CustomDataSource | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const ds = new Cesium.CustomDataSource('lightning');
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
      useLightningStatus.getState().setStatus({ connected: false, ratePerMin: 0, error: null });
      viewer.scene.requestRender();
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;
    let relayIndex = 0;
    let seq = 0;
    const strikes = new Map<number, Strike>();
    const recent: number[] = []; // timestamps for the strikes/min readout

    // --- Bolt strike-down animation ------------------------------------------
    // Driven by requestAnimationFrame (not Cesium's clock) so it stays smooth in
    // the viewer's on-demand render mode. CallbackProperties pull live progress
    // from performance.now(); the loop just requests renders and reaps finished
    // bolts, and idles itself when nothing is animating.
    interface BoltAnim {
      lon: number;
      lat: number;
      path: Cesium.Cartesian3[];
      start: number;
      bolt: Cesium.Entity;
      ring: Cesium.Entity;
    }
    const anims: BoltAnim[] = [];
    let rafId: number | null = null;

    const boltPositions = (a: BoltAnim): Cesium.Cartesian3[] => {
      const p = Math.min(1, (performance.now() - a.start) / BOLT_DESCEND_MS);
      if (p >= 1) return a.path;
      // Reveal the path from the top down to a fractional vertex (the leader).
      const segs = a.path.length - 1;
      const fpos = p * segs;
      const idx = Math.floor(fpos);
      const out = a.path.slice(0, idx + 1);
      if (idx < segs) {
        out.push(
          Cesium.Cartesian3.lerp(a.path[idx], a.path[idx + 1], fpos - idx, new Cesium.Cartesian3())
        );
      }
      return out;
    };

    const boltColor = (a: BoltAnim): Cesium.Color => {
      const e = performance.now() - a.start;
      if (e <= BOLT_DESCEND_MS) return BOLT_COLOR;
      const k = (e - BOLT_DESCEND_MS) / (BOLT_LIFE_MS - BOLT_DESCEND_MS);
      return BOLT_COLOR.withAlpha(Math.max(0, 1 - k));
    };

    const ringFlashColor = (a: BoltAnim): Cesium.Color => {
      const p = Math.min(1, (performance.now() - a.start) / RING_FLASH_MS);
      const alpha = 0.85 * (1 - p) * (1 - p); // bright pop, then ease-out fade
      return RING_COLOR.withAlpha(Math.max(0, alpha));
    };

    const animate = () => {
      const now = performance.now();
      const ttl = Math.max(BOLT_LIFE_MS, RING_FLASH_MS);
      for (let i = anims.length - 1; i >= 0; i--) {
        if (now - anims[i].start >= ttl) {
          ds.entities.remove(anims[i].bolt);
          ds.entities.remove(anims[i].ring);
          anims.splice(i, 1);
        }
      }
      if (anims.length) {
        viewer.scene.requestRender();
        rafId = requestAnimationFrame(animate);
      } else {
        rafId = null;
      }
    };

    const spawnBolt = (lon: number, lat: number) => {
      if (anims.length >= MAX_ANIMS) return;
      const anim = {
        lon,
        lat,
        path: makeBoltPath(lon, lat),
        start: performance.now(),
      } as BoltAnim;

      anim.bolt = ds.entities.add({
        polyline: {
          positions: new Cesium.CallbackProperty(() => boltPositions(anim), false),
          width: 3,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.22,
            color: new Cesium.CallbackProperty(() => boltColor(anim), false),
          }),
        },
      });

      anim.ring = ds.entities.add({
        polyline: {
          // Geometry built once (constant radius); only the colour alpha animates.
          positions: circlePositions(lon, lat, RING_FIXED_M),
          width: 2,
          clampToGround: true,
          material: new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty(() => ringFlashColor(anim), false)
          ),
        },
      });

      anims.push(anim);
      if (rafId == null) rafId = requestAnimationFrame(animate);
    };

    // The global stream delivers tens of strikes/sec worldwide. Spawning the
    // descending-bolt animation for every one keeps the RAF loop (and thus
    // full-scene rendering) running 24/7 even when every strike is on the far
    // side of the globe. Cache the camera's view rectangle and only animate
    // strikes that are actually in view — off-screen strikes still get their
    // crosshair billboard.
    let viewRect: Cesium.Rectangle | null = viewer.camera.computeViewRectangle() ?? null;
    const offCamera = viewer.camera.changed.addEventListener(() => {
      viewRect = viewer.camera.computeViewRectangle() ?? null;
    });
    const scratchCarto = new Cesium.Cartographic();
    const inView = (lon: number, lat: number): boolean => {
      if (!viewRect) return true; // can't tell — keep the old behavior
      Cesium.Cartographic.fromDegrees(lon, lat, 0, scratchCarto);
      return Cesium.Rectangle.contains(viewRect, scratchCarto);
    };

    // Billboard-only strikes don't need a render per message — coalesce to one
    // render per ~250ms (bolt animations drive their own frames via the RAF loop).
    let renderTimer: ReturnType<typeof setTimeout> | null = null;
    const requestRenderSoon = () => {
      if (renderTimer) return;
      renderTimer = setTimeout(() => {
        renderTimer = null;
        viewer.scene.requestRender();
      }, 250);
    };

    const connect = () => {
      if (cancelled) return;
      const url = RELAYS[relayIndex % RELAYS.length];
      relayIndex++;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      socket = ws;

      ws.onopen = () => {
        if (cancelled) return;
        // Subscribe to the global strike stream.
        ws.send(JSON.stringify({ a: 111 }));
        useLightningStatus.getState().setStatus({ connected: true, error: null });
      };

      ws.onmessage = (event) => {
        if (cancelled || typeof event.data !== 'string') return;
        let strike: {
          lat?: number;
          lon?: number;
          time?: number;
        } | null = null;
        try {
          strike = JSON.parse(inflate(event.data));
        } catch {
          try {
            strike = JSON.parse(event.data);
          } catch {
            return;
          }
        }
        if (!strike || typeof strike.lat !== 'number' || typeof strike.lon !== 'number') return;

        const id = seq++;
        const now = Date.now();
        strikes.set(id, { lat: strike.lat, lon: strike.lon, t: now, stage: 0 });
        recent.push(now);

        ds.entities.add({
          id: `bolt-${id}`,
          // Fresh strike sits at the stage-0 altitude lift so it draws over older
          // ones at the same spot (see X_STAGES).
          position: Cesium.Cartesian3.fromDegrees(strike.lon, strike.lat, X_STAGES[0].altM),
          billboard: {
            image: BOLT_ICON,
            width: 22,
            height: 22,
            color: X_STAGES[0].color, // fresh: white
            // Default depth test (disableDepthTestDistance = 0) so strikes on the
            // far side of the planet are correctly hidden behind the globe.
          },
        });

        // Fire the dramatic descending bolt + red impact flash — only where the
        // camera can actually see it.
        if (inView(strike.lon, strike.lat)) spawnBolt(strike.lon, strike.lat);

        // Enforce the cap by evicting the oldest strikes (Map preserves
        // insertion order — walk keys instead of copying all of them).
        while (strikes.size > MAX_STRIKES) {
          const oid = strikes.keys().next().value;
          if (oid === undefined) break;
          strikes.delete(oid);
          ds.entities.removeById(`bolt-${oid}`);
        }
        requestRenderSoon();
      };

      ws.onerror = () => {
        useLightningStatus.getState().setStatus({ connected: false });
      };

      ws.onclose = () => {
        if (cancelled) return;
        useLightningStatus.getState().setStatus({ connected: false });
        scheduleReconnect();
      };
    };

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 3000);
    };

    // Step strikes through their discrete colour stages and retire expired ones.
    // The hot path is the early-out: a strike whose stage hasn't changed since
    // last tick is skipped entirely — no allocation, no entity touch — so a sky
    // full of settled crosshairs costs almost nothing and never forces a render.
    const tick = () => {
      const now = Date.now();
      let changed = false;
      for (const [id, s] of strikes) {
        const age = now - s.t;
        if (age >= STRIKE_LIFETIME_MS) {
          strikes.delete(id);
          ds.entities.removeById(`bolt-${id}`);
          changed = true;
          continue;
        }
        const stage = stageForAge(age);
        if (stage === s.stage) continue; // unchanged — leave the billboard alone
        s.stage = stage;
        const entity = ds.entities.getById(`bolt-${id}`);
        if (!entity?.billboard) continue;
        const st = X_STAGES[stage];
        entity.billboard.color = new Cesium.ConstantProperty(st.color);
        // Drop to this stage's altitude so it sinks beneath newer strikes.
        entity.position = new Cesium.ConstantPositionProperty(
          Cesium.Cartesian3.fromDegrees(s.lon, s.lat, st.altM)
        );
        changed = true;
      }

      // Trim the rate window to the last 60s and publish the readout — but only
      // when it changed, so subscribers aren't notified once a second for nothing.
      const cutoff = now - 60_000;
      while (recent.length && recent[0] < cutoff) recent.shift();
      if (useLightningStatus.getState().ratePerMin !== recent.length) {
        useLightningStatus.getState().setStatus({ ratePerMin: recent.length });
      }

      if (changed) viewer.scene.requestRender();
    };

    connect();
    const ticker = setInterval(tick, TICK_MS);

    return () => {
      cancelled = true;
      clearInterval(ticker);
      offCamera();
      if (renderTimer) clearTimeout(renderTimer);
      if (rafId != null) cancelAnimationFrame(rafId);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) {
        socket.onclose = null; // don't trigger a reconnect on intentional close
        socket.close();
      }
      ds.entities.removeAll();
      useLightningStatus.getState().setStatus({ connected: false, ratePerMin: 0 });
    };
  }, [viewer, active]);

  return null;
}
