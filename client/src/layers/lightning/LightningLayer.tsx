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
const TICK_MS = 250; // fade/cleanup cadence (smooth enough for the strike flash)

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
}

const FLASH_MS = 850; // how long the bright "pop" lasts before settling
const hex = (s: string) => Cesium.Color.fromCssColorString(s);
const FRESH = hex('#ffffff'); // new-strike flash

// Recency heat ramp for the settled crosshair — a strike "cools" from a hot
// white flash through gold/yellow/orange to a dying red over its lifetime, so
// the age of every strike is readable at a glance.
const AGE_RAMP: Array<{ at: number; c: Cesium.Color }> = [
  { at: 0.0, c: hex('#ffffff') },
  { at: 0.1, c: hex('#fff7b0') },
  { at: 0.28, c: hex('#ffe14d') },
  { at: 0.55, c: hex('#ff9d2e') },
  { at: 1.0, c: hex('#ff3b30') },
];

function colorForAge(frac: number): Cesium.Color {
  const f = Math.max(0, Math.min(1, frac));
  for (let i = 1; i < AGE_RAMP.length; i++) {
    if (f <= AGE_RAMP[i].at) {
      const a = AGE_RAMP[i - 1];
      const b = AGE_RAMP[i];
      const t = (f - a.at) / (b.at - a.at || 1);
      return Cesium.Color.lerp(a.c, b.c, t, new Cesium.Color());
    }
  }
  return AGE_RAMP[AGE_RAMP.length - 1].c.clone();
}

// --- Strike-down animation tuning --------------------------------------------
const BOLT_TOP_M = 120_000; // altitude the leader descends from
const BOLT_DESCEND_MS = 150; // time for the leader to reach the ground
const BOLT_LIFE_MS = 480; // total bolt life (descend + flash-out)
const RING_LIFE_MS = 700; // ground shockwave bloom duration
const RING_MAX_M = 38_000; // shockwave outer radius
const MAX_ANIMS = 80; // concurrent bolt animations (storm safety valve)
const BOLT_COLOR = hex('#f2f9ff'); // blue-white bolt
const RING_COLOR = hex('#bfe9ff'); // pale shockwave

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

    const ringRadius = (a: BoltAnim): number => {
      const p = Math.min(1, (performance.now() - a.start) / RING_LIFE_MS);
      const eased = 1 - (1 - p) * (1 - p); // ease-out
      return 1_500 + eased * RING_MAX_M;
    };

    const ringPositions = (a: BoltAnim): Cesium.Cartesian3[] => {
      const r = ringRadius(a);
      const N = 48;
      const dLatM = r / 111_320;
      const dLonM = r / (111_320 * Math.cos((a.lat * Math.PI) / 180));
      const pts: Cesium.Cartesian3[] = [];
      for (let i = 0; i <= N; i++) {
        const ang = (i / N) * 2 * Math.PI;
        pts.push(
          Cesium.Cartesian3.fromDegrees(
            a.lon + dLonM * Math.sin(ang),
            a.lat + dLatM * Math.cos(ang)
          )
        );
      }
      return pts;
    };

    const ringColor = (a: BoltAnim): Cesium.Color => {
      const p = Math.min(1, (performance.now() - a.start) / RING_LIFE_MS);
      return RING_COLOR.withAlpha(Math.max(0, 0.45 * (1 - p)));
    };

    const animate = () => {
      const now = performance.now();
      const ttl = Math.max(BOLT_LIFE_MS, RING_LIFE_MS);
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
          positions: new Cesium.CallbackProperty(() => ringPositions(anim), false),
          width: 2,
          clampToGround: true,
          material: new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty(() => ringColor(anim), false)
          ),
        },
      });

      anims.push(anim);
      if (rafId == null) rafId = requestAnimationFrame(animate);
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
        let strike: { lat?: number; lon?: number; time?: number } | null = null;
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
        strikes.set(id, { lat: strike.lat, lon: strike.lon, t: now });
        recent.push(now);

        ds.entities.add({
          id: `bolt-${id}`,
          position: Cesium.Cartesian3.fromDegrees(strike.lon, strike.lat),
          billboard: {
            image: BOLT_ICON,
            width: 22,
            height: 22,
            color: FRESH,
            scale: 2.4, // born big & bright; the ticker settles it
            // Default depth test (disableDepthTestDistance = 0) so strikes on the
            // far side of the planet are correctly hidden behind the globe.
          },
        });

        // Fire the dramatic descending bolt + ground shockwave.
        spawnBolt(strike.lon, strike.lat);

        // Enforce the cap by evicting the oldest strikes.
        if (strikes.size > MAX_STRIKES) {
          const oldest = [...strikes.keys()].slice(0, strikes.size - MAX_STRIKES);
          for (const oid of oldest) {
            strikes.delete(oid);
            ds.entities.removeById(`bolt-${oid}`);
          }
        }
        viewer.scene.requestRender();
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

    // Fade aging strikes through the heat ramp and retire the expired ones.
    const tick = () => {
      const now = Date.now();
      let changed = false;
      for (const [id, s] of strikes) {
        const age = now - s.t;
        const entity = ds.entities.getById(`bolt-${id}`);
        if (!entity?.billboard) continue;
        if (age >= STRIKE_LIFETIME_MS) {
          strikes.delete(id);
          ds.entities.removeById(`bolt-${id}`);
          changed = true;
          continue;
        }
        let scale: number;
        let color: Cesium.Color;
        if (age < FLASH_MS) {
          // Initial pop: shrink 2.4 -> 1.0 while bright white.
          scale = 2.4 - 1.4 * (age / FLASH_MS);
          color = FRESH;
        } else {
          // Settled crosshair that cools white -> yellow -> orange -> red, only
          // fading to transparent in the final stretch of its life.
          scale = 1;
          const lifeFrac = (age - FLASH_MS) / (STRIKE_LIFETIME_MS - FLASH_MS);
          const alpha = lifeFrac < 0.75 ? 1 : Math.max(0.1, 1 - (lifeFrac - 0.75) / 0.25);
          color = colorForAge(lifeFrac).withAlpha(alpha);
        }
        entity.billboard.scale = new Cesium.ConstantProperty(scale);
        entity.billboard.color = new Cesium.ConstantProperty(color);
        changed = true;
      }

      // Trim the rate window to the last 60s and publish the readout.
      const cutoff = now - 60_000;
      while (recent.length && recent[0] < cutoff) recent.shift();
      useLightningStatus.getState().setStatus({ ratePerMin: recent.length });

      if (changed) viewer.scene.requestRender();
    };

    connect();
    const ticker = setInterval(tick, TICK_MS);

    return () => {
      cancelled = true;
      clearInterval(ticker);
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
