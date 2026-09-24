import { parseFrame, type LiveStrike } from './strikeKey';
import { relayBackoffMs } from './liveFeed';

// Blitzortung's community lightning network publishes real-time strikes over a
// set of public WebSocket relays. There's no official API, so we connect to the
// known relays (rotating on failure) and decode their lightly-compressed frames
// the same way the public lightningmaps.org client does. This is the browser's
// own feed — the server runs its own collector for the 24 h history; the two
// agree on each strike's key (parseFrame), so a strike seen by both dedupes.
const RELAYS = [
  'wss://ws1.blitzortung.org/',
  'wss://ws7.blitzortung.org/',
  'wss://ws8.blitzortung.org/',
];

// The global stream never pauses for a minute (it runs at tens of strikes a
// second), so a socket that has said nothing for this long is dead even if
// the browser still reports it open — close it and move to the next relay.
export const SOCKET_WATCHDOG_MS = 60_000;
const WATCHDOG_CHECK_MS = 5_000;

export interface BlitzortungSocketOpts {
  /** Server-corrected clock: the receive time parseFrame falls back to and validates against. */
  now: () => number;
  onStrike: (s: LiveStrike) => void;
  onConnected: (connected: boolean) => void;
}

/** Connect and keep connected until the returned stop() is called. */
export function startBlitzortungSocket(opts: BlitzortungSocketOpts): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let relayIndex = 0;
  // Consecutive attempts that ended without a strike. Reset by a delivered
  // strike, not by onopen: a relay that accepts the connection but never
  // sends would otherwise be retried every 3 s forever.
  let attempt = 0;
  let lastHeardAt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const detach = (ws: WebSocket) => {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null; // don't trigger a reconnect on intentional close
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    const delay = relayBackoffMs(attempt);
    attempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  // Common path for close, error-close and the watchdog.
  const down = (ws: WebSocket) => {
    if (socket !== ws) return;
    detach(ws);
    socket = null;
    opts.onConnected(false);
    scheduleReconnect();
  };

  const connect = () => {
    if (stopped) return;
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
    // Counts from creation, so a connection stuck in CONNECTING is caught too.
    lastHeardAt = Date.now();

    ws.onopen = () => {
      if (stopped) return;
      // Subscribe to the global strike stream.
      ws.send(JSON.stringify({ a: 111 }));
      opts.onConnected(true);
    };

    ws.onmessage = (event) => {
      if (stopped) return;
      lastHeardAt = Date.now();
      if (typeof event.data !== 'string') return;
      const strike = parseFrame(event.data, opts.now());
      if (!strike) return;
      attempt = 0;
      opts.onStrike(strike);
    };

    ws.onclose = () => down(ws);
    // An error is always followed by close; report the disconnect right away.
    ws.onerror = () => opts.onConnected(false);
  };

  const watchdog = setInterval(() => {
    const ws = socket;
    if (stopped || !ws || Date.now() - lastHeardAt < SOCKET_WATCHDOG_MS) return;
    // A half-dead connection may take minutes to fire onclose after close(),
    // so detach first and treat it as closed now.
    down(ws);
    try {
      ws.close();
    } catch {
      /* already closing */
    }
  }, WATCHDOG_CHECK_MS);

  connect();

  return () => {
    stopped = true;
    clearInterval(watchdog);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const ws = socket;
    socket = null;
    if (ws) {
      detach(ws);
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    }
  };
}
