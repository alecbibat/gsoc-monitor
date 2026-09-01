# Precipitation Radar — rebuilt (Sep 2026)

The radar layer was scrapped and rebuilt from scratch. This documents the new
system: what it's built on, how it works, how to develop against it without
reaching the real weather hosts, and its known limits.

## Why the old one was scrapped

The old implementation was RainViewer-only, and RainViewer locked down its
free tier effective **January 1, 2026**: max zoom **7** (512px tiles),
**Universal Blue** color scheme only, **past radar only** (nowcast and IR
satellite discontinued), hash-based frame paths, ~100 req/IP/min. The old
code requested tiles to zoom 9 — above 7 the CDN serves images with *"Zoom
level is not supported"* burned in, which is exactly what users saw — and
reverse-engineered its colors by nearest-anchor-guessing dBZ out of served
pixels. None of that was fixable by tuning.

## Sources

| Channel | Source | Coverage | Cadence | Native detail | Colors |
|---|---|---|---|---|---|
| **US HD** | NOAA NEXRAD N0Q composite via [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/) | CONUS + AK + HI + PR + Guam | 5 min | ~1 km (≈ z12) | documented ramp (`composite_n0q`: index i ⇒ dBZ = (i−65)/2) |
| **Global** | RainViewer free tier | worldwide | 10 min | z7 max (hard cap) | Universal Blue (calibrated anchors) |

- US HD frames use IEM's **immutable timestamped URLs**
  (`/c/tile.py/1.0.0/ridge::USCOMP-N0Q-YYYYMMDDHHMI/{z}/{x}/{y}.png`,
  UTC minute % 5, ~14-day retention, 14-day cache headers) — no temporal
  tearing, aggressive browser caching. The `{y}` is **standard XYZ**, not
  TMS, despite the `1.0.0` path (the server is configured `tms_type=google`).
- `/api/radar` returns a merged manifest: RainViewer's past frames (proxied +
  cached 2 min, stale-on-error) plus a clock-derived IEM frame schedule
  (lagged 8 min — the top of IEM's documented generation delay — so advertised frames exist). A RainViewer outage degrades to
  HD-only instead of failing.
- Both tile sets are fetched browser-direct (CORS `*` on both hosts), never
  proxied through the dyno.

## Options (sidebar)

- **Coverage** — `Auto` (US HD stacked over global; the global source is
  pixel-masked inside US HD coverage so the two composites never
  double-paint), `US HD`, `Global`.
- **Style** — `Storm`: both sources inverted to dBZ (lossless for IEM via the
  documented ramp; calibrated anchors for RainViewer) → data-space smoothing
  (normalized-convolution blur, edge-padded) → one zoom.earth-style palette
  with per-pixel alpha. `Agency`: each source's native colors, zero pixel
  processing — the robustness fallback if either provider ever repaints.
- **Window** — 1h / 2h (default 2h). **Opacity** slider. Changing window or
  receiving new frames preserves the moment under a paused/scrubbed handle
  (anchored by time, not index) and keeps a LIVE view pinned LIVE.

## Rendering engine (the part that is load-bearing)

One Cesium `ImageryLayer` **per frame**, created lazily/batched when the frame
list changes, **retained**, and animated by **alpha only** (900 ms cadence,
500 ms crossfade; the higher-stacked layer decides the dip-free fade
direction). Do NOT "optimize" this into add/remove-per-tick: every
imagery-layer mutation makes Cesium's globe surface re-attach imagery across
all rendered tiles, and per-tick mutations keep the quadtree from ever
settling — verified empirically (the globe stops refining and radar never
draws). Stack mutations happen only when the frame list changes (~5 min) or
on settings changes.

Supporting pieces:

- **Decoded-tile LRU cache** (`providers.ts`): recolored tiles cached by
  frame/tile/style, so scrub revisits, style flips, and stack rebuilds
  repaint from memory.
- **Zoom caps**: RainViewer `maximumLevel: 7` (the whole "zoom level not
  supported" class of bug is structurally gone), IEM `maximumLevel: 12`;
  beyond native levels Cesium magnifies our smoothed textures bilinearly —
  the same upsampling trick zoom.earth uses.
- **Timeline** (`radarStore.buildTimeline`): the union of both channels'
  frame times in the window (near-duplicates merged onto HD times); each slot
  shows each channel's nearest frame within tolerance. The view **pins to
  LIVE** — if you're on the newest frame when a manifest update lands, you
  stay on the newest frame.
- `requestRenderMode` is on: every mutation calls
  `viewer.scene.requestRender()`; every viewer touch guards `isDestroyed()`
  (WebGL context-loss recovery destroys the viewer under stale closures).

## Dev/test without weather-host egress: `?radarsim=1`

`server/src/routes/radarSim.ts` (mounted only when `NODE_ENV !==
'production'`) serves a synthetic moving storm field in **both providers'
exact URL shapes and palettes**, including RainViewer's error tile above z7
(as an unmissable striped tile — if it ever appears, the zoom cap regressed).
The client flag `?radarsim=1` switches the manifest + both tile templates to
the sim endpoints and swaps the dark basemap for Cesium's bundled Natural
Earth II so everything runs fully offline. This is how the rebuild was
verified end-to-end (Playwright + headless Chromium) in a sandbox with no
route to the real hosts.

## Known limits & follow-ups

- **No forecast frames**: RainViewer discontinued free nowcast; the timeline
  is past→now. A future forecast channel could use IEM's HRRR reflectivity
  tiles (`hrrr-ref-…`) — unverified, candidate follow-up.
- **Global outside US is z7-soft** — that's the free tier's ceiling. If
  street-level global radar ever matters, the options are national-network
  adapters (MSC GeoMet for Canada is an easy first: 1 km, 6-min WMS).
- **IEM is a best-effort academic service** (no SLA; outages documented).
  Degradation path: the server health-probes IEM each manifest cycle and
  reports `us.available`; when it goes false, Auto coverage drops the HD
  channel, stops masking the global layer over the US, and the sidebar shows
  a warning — radar over the US degrades to the global composite instead of
  a radar-shaped hole.
- **Verify once from a real browser** that both hosts still send
  `Access-Control-Allow-Origin: *` (researched from their configs, not
  curl-able from the build sandbox).
- The clouds/IR layer from the old system is gone (its free source was
  discontinued). NASA GIBS GOES GeoColor WMTS (keyless, CORS, 10-min) is the
  candidate if a clouds channel is wanted again.
