# Radar Redesign Proposals

Three plans for scrapping the current precipitation-radar implementation and rebuilding it, with a recommendation. Written against the code as of `main` (Aug 2026).

---

## Why scrap it — what the current radar actually does

The current implementation (`client/src/layers/radar/`, ~1,130 lines + 226 server lines) has four structural problems that tuning can't fix:

1. **The color pipeline is a reverse-engineering hack.** RainViewer's CDN ignores the color-scheme path parameter and serves one fixed house palette for every scheme id (verified Aug 2026 via the `/api/radar/diag` probe — scheme 0, 2, and 4 returned byte-identical tiles). So `recolor.ts` *inverts the served palette*: every pixel is nearest-anchor-matched against 17 hand-calibrated RGB anchors to guess a dBZ back out, then blurred and re-colored through our own LUT. If RainViewer changes their palette, the radar silently degrades to wrong intensities — there is no error path. A ~200-line temporary diagnostic endpoint (hand-rolled PNG decoder) still lives in `server/src/routes/radar.ts` because of this.

2. **One Cesium `ImageryLayer` per timeline frame.** A 120-min window is ~12 past + ~3 nowcast = **15 live imagery layers**, each fetching its own tile pyramid for the viewport; combined mode adds up to ~15 more keyed-cloud layers. Any palette, mode, or window change — and every manifest refresh that carries a new frame — tears down and rebuilds the whole stack: on the order of 100–300 tile downloads + recolors for a single palette click.

3. **All pixel work is on the main thread.** Per 512px tile: decode → `getImageData` → per-pixel palette inversion → edge-pad → blur → per-pixel LUT map → `putImageData`. Tile bursts jank the UI thread of an app that is simultaneously propagating satellites, flights, and ships.

4. **Playback is a stepped slideshow.** 800 ms per frame with a 720 ms alpha dissolve between pre-built layers. No temporal interpolation; scrubbing snaps between 10-minute frames. Combined (radar-over-clouds) mode shipped uncalibrated and the default was reverted to plain radar.

Underneath all of it, RainViewer's data ceiling: ~1 km smoothed global composite, 10-minute cadence, ~30-min nowcast, reflectivity only.

**Worth keeping:** the palette ramps in `palettes.ts` (the storm ramp is genuinely good), the timeline-scrubber concept, the manifest proxy + cache pattern, and the data-space-smoothing insight in `recolor.ts`.

---

## Plan A — REFIT

*Same data, same look — replace the engine underneath.*

**Concept.** Keep RainViewer and the current visual design. Scrap the N-layer stack and main-thread pixel pipeline; rebuild acquisition and rendering as a cached, worker-fed, two-layer crossfader.

**Architecture.**

- **Frame store**: decoded field tiles (post-inversion magnitude + presence, before palette) cached in memory keyed `frame/z/x/y`. Downloaded once; palette changes re-map the cached fields through a LUT — zero re-downloads.
- **Worker pool**: PNG decode → inversion → data-space blur runs in 2–4 Web Workers (`OffscreenCanvas`/`createImageBitmap`), transferring bitmaps back. Main thread never touches pixels.
- **Two imagery layers** (front/back): playback builds the next frame's layer from cache, crossfades, drops the old one. The stack is never rebuilt wholesale; new manifest frames diff in incrementally (evict oldest, append newest).
- **Prefetch ring**: frames N+1, N+2 decode ahead of the playhead; the timeline shows a buffered-range indicator and scrubbing is instant (cache hit).
- Delete the `/diag` endpoint (fold its findings into a calibration fixture/test).

**UI.** Timeline keeps its current layout, gains a buffered indicator. Sidebar controls trimmed (mode / palette / opacity). No new surfaces.

**Fixes:** memory (2 layers, not ~30), bandwidth (palette/mode switches are free), jank (workers), teardown storms, slow scrubbing.
**Doesn't fix:** the palette-inversion fragility (still guessing RainViewer's ramp), the 10-min cadence, stepped playback.

**Effort:** ~4–6 dev-days. **Risk: low** — pure client refactor, no new data dependencies, look is unchanged.

---

## Plan B — OPS RADAR *(recommended)*

*Rebuild radar as an operational product for a GSOC, on data we control.*

**Concept.** Operators don't watch radar for aesthetics — they ask *"which of our assets is about to get hit, how hard, and when?"* Plan B keeps Plan A's engine as its first milestone, then replaces the data layer and couples radar to the intelligence already in the app (NWS warnings, lightning, monitored assets).

**Data.**

- **CONUS**: NEXRAD/MRMS composite reflectivity via the Iowa Environmental Mesonet tile cache (free, no key, ~5-min cadence, time-stepped historical endpoints, and a *documented, stable* color table — inversion becomes a lossless documented mapping instead of a guess). Fallback candidate: NOAA nowCOAST time-enabled WMS. **Milestone 0 (½ day) verifies endpoints/cadence before anything else.**
- **Global**: RainViewer stays as the fallback layer outside CONUS coverage. Both sources are recolored through the *same* palette LUTs, so the seam is a resolution/cadence seam, not a color seam. MRMS renders above RainViewer, clipped to its coverage rectangle.

**Ops features (the actual redesign):**

- **Site-watch**: for monitored assets/AOIs, a worker thresholds decoded fields (≥ 45 dBZ), extracts cell centroids, tracks them frame-to-frame → approach vector, closing speed, ETA. Surfaces as a callout chip: `52 dBZ core · 18 km NW · closing 38 km/h · ETA ≈ 28 min`.
- **Warning coupling**: NWS warning polygons already in the app pulse when live echo ≥ threshold intersects them — warnings with weather in them read differently from empty ones.
- **Inspector**: click anywhere → dBZ + estimated rain rate (Z–R: Z = 300·R^1.4) readout in the existing panel system.
- **Timeline severity ticks**: each frame's tick colored by max dBZ near AOIs/viewport — the timeline shows *when it got bad* at a glance.
- **Legend**: proper dBZ scale bar; source + cadence badge (`MRMS · 2–5 min` / `RainViewer · global · 10 min`).

**Fixes:** everything Plan A fixes, plus the inversion hack (on CONUS), cadence (5-min vs 10), and — the real upgrade — the radar starts *telling operators things* instead of being wallpaper.
**Doesn't fix:** stepped playback (inherits Plan A's crossfade); global coverage still RainViewer-grade outside CONUS.

**Effort:** ~12–15 dev-days including Plan A's engine (M0 verify ½d · M1 engine refit ~5d · M2 sources + seam ~4d · M3 ops features ~5d). Each milestone ships independently.
**Risk: medium** — two upstream sources to blend; cell tracking needs tuning (mitigation: ship tracking as "beta" chip; thresholds configurable).

---

## Plan C — FIELD ENGINE

*One GPU layer, raw data textures, true temporal morphing — the zoom.earth/Windy endgame.*

**Concept.** Stop rendering radar as stacks of pre-colored image tiles at all. Radar becomes a single custom render pass over scalar *fields*.

**Architecture.**

- Workers assemble each frame's tiles into an equirectangular **field texture** (single-channel dBZ; regional higher-res re-composite when the camera settles).
- A custom Cesium primitive/material samples **two** frame textures with a continuous time uniform `t` and a 256×1 **palette LUT texture**: playback is a 60 fps shader interpolation, not an 800 ms crossfade. Scrubbing is continuous. Palette switch = swap a 1 KB texture, instant. Opacity = uniform.
- **Optical flow** (phase correlation between consecutive low-res fields, in a worker) yields a motion-vector texture: the shader *advects* samples along flow instead of blending in place — cells visibly move between frames rather than dissolving. Free by-product: storm-motion arrows as a toggleable overlay.
- Source-agnostic: consumes decoded fields, so it sits equally on RainViewer or Plan B's MRMS adapter.

**Fixes:** everything Plan A fixes, plus playback quality (true motion), instant palette/opacity, memory (2–3 textures instead of ~30 tile pyramids).
**Doesn't fix:** data products/cadence (renderer-only — inherits whatever source feeds it); no new operational signal.

**Effort:** ~15–20 dev-days. **Risk: high** — custom GLSL inside Cesium's pipeline (API churn), reprojection correctness at horizon/poles, composite-resolution management vs zoom, WebGL context-loss handling (already a known hazard in this app), mobile GPU memory.

---

## Comparison

| | A · Refit | B · Ops Radar | C · Field Engine |
|---|---|---|---|
| Kills the palette-inversion hack | ✗ (still guessed) | ✓ CONUS (documented palette) | ✗ (renderer-only) |
| US cadence / detail | 10 min · ~1 km | **2–5 min · MRMS** | inherits source |
| Global coverage | ✓ RainViewer | ✓ RainViewer fallback | inherits source |
| Playback | stepped crossfade | stepped crossfade | **60 fps morphing** |
| Palette switch | free (cache re-map) | free | **instant (GPU LUT)** |
| Main-thread pixel work | none (workers) | none | none |
| New operational signal | — | **site-watch · warning coupling · inspector** | motion arrows |
| Effort (dev-days) | 4–6 | 12–15 (incl. A) | 15–20 |
| Risk | low | medium | high |

## Recommendation — Plan B, staged so Plan A is its first shipped milestone

For a *GSOC monitor*, Plan B is the only plan that changes what the radar **tells** operators, not just how it renders — and it retires the most fragile thing in the codebase (the reverse-engineered palette) by moving the primary coverage area to a documented source, rather than building more machinery on top of a guess.

The staging removes most of the risk: M1 *is* Plan A, shipped standalone — if priorities shift after week one, the engine refit is already banked. And because the refit isolates acquisition behind a frame-store interface, Plan C's GPU renderer remains a clean future upgrade that slots under the same interface — it's deferred, not foreclosed.

Choose C first only if the visual experience is the product; choose A alone only if radar must stay a background layer and a week is all it's worth.
