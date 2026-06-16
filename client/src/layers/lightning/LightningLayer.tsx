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

const STRIKE_LIFETIME_MS = 30_000; // how long a flash lingers before fading out
const MAX_STRIKES = 900; // hard cap so a busy storm can't flood the scene
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
const FRESH = Cesium.Color.fromCssColorString('#ffffff'); // new-strike flash
const HOT = Cesium.Color.fromCssColorString('#76e6ff'); // settled electric blue

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

    // Fade aging strikes toward transparent and retire the expired ones.
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
          // Settled crosshair that fades to transparent over its remaining life.
          scale = 1;
          const k = 1 - (age - FLASH_MS) / (STRIKE_LIFETIME_MS - FLASH_MS);
          color = HOT.withAlpha(Math.max(0.05, k));
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
