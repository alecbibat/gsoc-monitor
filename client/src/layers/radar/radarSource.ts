// Where radar pixels come from.
//
// Everything above this file — the worker pipeline, the ping-pong layers, the
// flow solver, the warp, the nowcast, the timeline — is about turning tiles into
// motion, and none of it cares whose tiles they are. This is the seam where that
// becomes true in the code rather than just in principle: the facts that differ
// between providers (tile size, deepest useful zoom, how a frame becomes a URL,
// how often frames arrive, where on Earth the source has data, which palette its
// bytes are encoded in) live here, and nowhere else.
//
// Two reasons it exists, both from the plan's risk table:
//
//   1. RainViewer has already discontinued its infrared product and its nowcast.
//      If the precipitation feed degrades too, swapping sources should be a new
//      entry in this file rather than an archaeology expedition.
//   2. It is the designed plug point for a first-party MRMS pipeline (the
//      pitch's Option 3) — same renderer, new RadarSource.
//
// A source is DATA plus a decoder id. It deliberately does not own fetching:
// tile bytes still travel through Cesium's RequestScheduler so throttling and
// cancellation keep working, and the crisis share page's keyless, client-side,
// no-proxy constraint is a property of the URLs, which are right here in view.

import type { RadarFrame } from '../../types';

// Which inversion the worker applies to a source's bytes.
//
// Radar tiles arrive already coloured by somebody else's palette, and the whole
// point of the client pipeline is to recover intensity and repaint it through
// ours. That inversion is palette-specific, so it is named by the source rather
// than assumed.
export type RadarDecoderId = 'rainviewer-universal-blue';

export interface RadarSource {
  id: string;
  /** Shown in the UI when more than one source can serve a view. */
  label: string;
  /** Attribution required by the provider's terms. */
  attribution: string;
  tileSize: number;
  /**
   * Deepest level worth requesting. Past this the renderer magnifies its own
   * smoothed texture, which is what zoom.earth does and is indistinguishable
   * from a provider that synthesises deep zooms by upscaling.
   */
  maxLevel: number;
  /** Minutes between consecutive observed frames. */
  cadenceMinutes: number;
  /**
   * Where the source has data, as [west, south, east, north] degrees. Null
   * means global.
   *
   * Degrees rather than a Cesium.Rectangle deliberately: this module describes
   * where pixels come from, and nothing about that is a rendering concern. It
   * is imported by the store, which is imported by UI that has no business
   * pulling in a globe engine.
   */
  coverage: [number, number, number, number] | null;
  decoder: RadarDecoderId;
  /**
   * Whether this source may be selected right now. A source can be fully
   * described and still not usable — see IEM below, which is held behind an
   * unresolved question about whether it can serve past frames at all.
   */
  available: boolean;
  /** Why not, when `available` is false. Surfaced in diagnostics. */
  unavailableReason?: string;
  tileUrl(host: string, frame: RadarFrame, z: number | string, x: number | string, y: number | string): string;
}

// The current source, and the only one the renderer has ever used.
//
// Colour scheme 2 (Universal Blue) with server smoothing on and snow folded into
// the rain ramp. The CDN currently ignores the scheme segment and serves the
// same palette whatever is asked for, but requesting the one the inverter's
// anchors were calibrated against means that if the parameter ever starts
// working again the bytes stay what we expect. See recolor.ts.
export const RAINVIEWER: RadarSource = {
  id: 'rainviewer',
  label: 'RainViewer',
  attribution: 'RainViewer',
  tileSize: 512,
  // Verified against the live CDN (Stage 0): z6 and z7 return real mosaics that
  // differ from their parents, while z8 through z11 all return the SAME
  // 3269-byte placeholder regardless of coordinates.
  maxLevel: 7,
  cadenceMinutes: 10,
  coverage: null,
  decoder: 'rainviewer-universal-blue',
  available: true,
  tileUrl: (host, frame, z, x, y) => `${host}${frame.path}/512/${z}/${x}/${y}/2/1_0.png`,
};

// Iowa Environmental Mesonet's CONUS composite — 5-minute data against
// RainViewer's 10-minute, over the United States only.
//
// HELD BACK, and the reason is worth stating precisely because it is the whole
// question this source turns on. A second source is only worth its complexity if
// it can fill a TIMELINE, and that needs past frames. IEM's tile cache exposes
// history through a slug on the product name (`USCOMP-N0Q-m05m` for five minutes
// ago, and so on), and Stage 0's probe found `-0`, `-m05m` and `-m50m` returning
// byte-identical payloads — which either means the slugs do not select past
// imagery, or means that particular tile was empty and all three agreed on a
// picture of nothing.
//
// `/api/radar/diag` now answers that: it finds a CONUS tile that HAS echo, walks
// the full slug ladder, and hashes each payload. Until it reports back, this
// stays unavailable — shipping a source that can only ever say "now" would put a
// five-minute cadence in the UI and a one-frame timeline behind it.
//
// Two things also remain undone here even if the slugs work: N0Q uses its own
// colour ramp, so it needs its own inversion (a second `RadarDecoderId`), and
// IEM's usage policy has not been read against app-scale traffic.
export const IEM_CONUS: RadarSource = {
  id: 'iem-conus',
  label: 'IEM CONUS',
  attribution: 'Iowa Environmental Mesonet',
  tileSize: 256,
  maxLevel: 7,
  cadenceMinutes: 5,
  coverage: [-126, 24, -66, 50],
  // Placeholder: N0Q is not Universal Blue, and pointing the existing inverter
  // at it would produce confident nonsense. A real decoder id lands with the
  // source.
  decoder: 'rainviewer-universal-blue',
  available: false,
  unavailableReason:
    'Gated on /api/radar/diag reporting that IEM time slugs return distinct ' +
    'imagery on a tile with echo. Also needs an N0Q palette inversion and a ' +
    'usage-policy review.',
  tileUrl: (_host, frame, z, x, y) =>
    `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-${frame.path}/${z}/${x}/${y}.png`,
};

const SOURCES = [RAINVIEWER, IEM_CONUS];

// The source serving a view, given its bounds in degrees.
//
// Regional preference — a higher-cadence regional source inside its coverage
// rectangle, the global one elsewhere — is what a second source is FOR, and the
// shape is here so it is one line when IEM clears its gate. With every regional
// source unavailable this returns the global one, which is exactly today's
// behaviour.
export function sourceForView(view: [number, number, number, number] | null): RadarSource {
  if (view) {
    const [vw, vs, ve, vn] = view;
    // A view crossing the antimeridian arrives with west > east (that is how
    // Cesium's computeViewRectangle expresses it), and such a view cannot be
    // inside any non-crossing coverage box — but it would PASS the four
    // comparisons below (a Bering Strait view [170, 30, -170, 45] "fits"
    // CONUS), so it must be rejected before them.
    const crossesAntimeridian = vw > ve;
    for (const source of SOURCES) {
      if (crossesAntimeridian) break;
      if (!source.available || !source.coverage) continue;
      const [cw, cs, ce, cn] = source.coverage;
      // Fully inside, not merely overlapping: a view straddling the coverage
      // edge would otherwise get a source with data for half of it, and half a
      // radar picture is worse than a coarser whole one.
      if (vw >= cw && ve <= ce && vs >= cs && vn <= cn) return source;
    }
  }
  return RAINVIEWER;
}

// The source in use. A single global source today; `sourceForView` is what makes
// it a choice once a regional one is available.
export function activeSource(): RadarSource {
  return RAINVIEWER;
}

/** Diagnostics: what the renderer could use, and why it cannot use the rest. */
export function sourceStatus() {
  return SOURCES.map((s) => ({
    id: s.id,
    available: s.available,
    cadenceMinutes: s.cadenceMinutes,
    maxLevel: s.maxLevel,
    coverage: s.coverage ? 'regional' : 'global',
    reason: s.unavailableReason ?? null,
  }));
}
