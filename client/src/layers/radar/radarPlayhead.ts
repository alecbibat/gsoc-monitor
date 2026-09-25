// Live playback state published by the radar engine, and the command bus the
// timeline and hotkeys drive it with. Deliberately outside zustand: the
// playhead moves every animation frame, and subscribers (the scrubber knob)
// write the DOM directly instead of re-rendering React at 60 fps.

export interface PlayheadState {
  position: number; // continuous playhead, in timeline frames
  index: number; // the frame mostly on screen
  playing: boolean;
  buffering: boolean; // waiting for the next frame's tiles
  ready: number; // frames fully loaded for the current view
  total: number; // frames in the loop
  readyMask: string; // per frame, '1' = loaded for the current view (buffer bar)
  live: boolean; // pinned to the newest frame (follows new frames as they land)
}

const INITIAL: PlayheadState = {
  position: 0,
  index: 0,
  playing: false,
  buffering: false,
  ready: 0,
  total: 0,
  readyMask: '',
  live: true,
};

let state: PlayheadState = INITIAL;
const listeners = new Set<(s: PlayheadState) => void>();

export const radarPlayhead = {
  get: (): PlayheadState => state,
  set(next: PlayheadState): void {
    const s = state;
    if (
      s.position === next.position &&
      s.index === next.index &&
      s.playing === next.playing &&
      s.buffering === next.buffering &&
      s.ready === next.ready &&
      s.total === next.total &&
      s.readyMask === next.readyMask &&
      s.live === next.live
    ) {
      return;
    }
    state = next;
    for (const fn of listeners) fn(next);
  },
  reset(): void {
    radarPlayhead.set(INITIAL);
  },
  subscribe(fn: (s: PlayheadState) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// Commands. The mounted radar engine registers itself; with no engine (layer
// off) they do nothing.
export interface RadarController {
  play(): void;
  pause(): void;
  toggle(): void;
  scrub(position: number): void; // drag: continuous, pauses playback
  endScrub(): void; // release: settle on the nearest frame
  step(delta: number): void; // ± whole frames, pauses playback
  latest(): void; // jump to the newest observed frame and stay pinned to it
  oldest(): void;
  // Reflectivity under a point on the frame mostly on screen (hover readout).
  probe(lon: number, lat: number): Promise<{ dbz: number; snow: boolean } | null>;
}

let controller: RadarController | null = null;

export function setRadarController(c: RadarController | null, owner?: RadarController): void {
  // An engine only clears the slot if it still owns it (a newer globe — e.g.
  // after a WebGL context rebuild — may have registered already).
  if (c === null && owner && controller !== owner) return;
  controller = c;
}

export const radarControl: RadarController = {
  play: () => controller?.play(),
  pause: () => controller?.pause(),
  toggle: () => controller?.toggle(),
  scrub: (p) => controller?.scrub(p),
  endScrub: () => controller?.endScrub(),
  step: (d) => controller?.step(d),
  latest: () => controller?.latest(),
  oldest: () => controller?.oldest(),
  probe: (lon, lat) => controller?.probe(lon, lat) ?? Promise.resolve(null),
};

// Dev-only handles for poking playback from the console and the headless
// harness (mirrors CesiumGlobe's window.__viewer).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w.__radarPlayhead = radarPlayhead;
  w.__radarControl = radarControl;
}
