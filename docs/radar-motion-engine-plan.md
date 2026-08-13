# Motion Engine Plan

Implementation plan for **Option 2 — The Motion Engine**, the chosen direction from the
[radar rework pitch](./radar-rework-pitch.html). Target: a precipitation radar that loads in
under two seconds, plays with continuous flow-interpolated motion, scrubs fluidly at any
instant, and rebuilds the forecast RainViewer discontinued — with **zero new infrastructure**.

The plan is staged so every stage ships standalone value, and Stage B is an explicit
go/no-go checkpoint: a "no" still leaves a dramatically better radar than today's.

| Stage | Duration | Ships |
|---|---|---|
| **0 — Production truth** | ½ day | Verified facts + recorded decisions |
| **A — The Refit** | ~6–8 dev-days | Fast load, zero jank, instant palettes, loop warming |
| **B — GPU spike** | ~4–5 dev-days | Go/no-go proof of the custom render path |
| **C — Motion** | ~10–15 dev-days | Flow interpolation, continuous timeline, advection nowcast, IEM source |

---

## Stage 0 — Production truth (half a day)

Five research claims are load-bearing and could not be verified from the dev sandbox
(its egress proxy blocks the relevant hosts). Production can reach them. **Nothing in
Stage A depends on these answers, so Stage 0 and Stage A can start in parallel — but
the answers must be recorded before Stage A's UI-pruning decisions land.**

**0.1 — Extend `/api/radar/diag`** (the temporary diagnostic endpoint in
`server/src/routes/radar.ts` — it already fetches live RainViewer tiles and has a PNG
decoder). Add to its report:
- Does the live manifest still contain `radar.nowcast[]` frames? `satellite.infrared[]`?
- Frame cadence and past-history depth actually observed in `radar.past[]`.
- A z8 and z9 tile request for a CONUS echo tile: HTTP status, byte size, and whether
  pixels differ from the parent z7 tile upscaled (i.e., is there real detail above z7?).
- A 30-tile burst timed fetch: any 429s? What `Cache-Control`/`Age` headers do tiles carry?

**0.2 — Browser-side probes** (devtools on the deployed app, or a temporary hidden debug
page): IEM tile cache CORS + latency from a real browser —
`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-0/{z}/{x}/{y}.png`
plus the time-slugged variants (`USCOMP-N0Q-m05m` … `-m50m`) and the MRMS-derived
`q2-hsr` product. Also confirm IEM's stated usage policy tolerates app-scale traffic.

**0.3 — The `_reload` spike** (bundled into Stage A's first PR): verify Cesium 1.121's
in-place provider reload (`provider._reload?.()` after mutating a URL-building closure)
swaps frames flicker-free with our custom `requestImage` override. This is the same hook
Cesium's own time-dynamic WMTS uses, but it is technically private — the spike pins the
behavior with a test so an upgrade regression is caught.

**0.4 — Baseline metrics**: instrument the current layer (time-to-first-radar-pixel,
tiles fetched per rebuild, long tasks during playback) so the improvement is measured,
not asserted. One session of recording before any refit code merges.

**Decisions to record at exit** (in this doc, under Stage 0 results):
- `RADAR_MAX_LEVEL` value (expected: 7, down from 9).
- Keep or prune the Clouds/Combined modes (expected: prune — IR discontinued upstream).
- Keep or drop upstream nowcast frames (expected: drop — replaced in Stage C by our own).
- IEM: approved as Stage C secondary source, or held back.

---

## Stage A — The Refit (~6–8 dev-days)

Goal: same visual design, new plumbing. Two Cesium imagery layers instead of 15–30, all
pixel work off the main thread, nothing refetched without reason, and the loop warmed
before playback. **Architecture below is shaped so Stage C plugs in without rework** —
the worker cache stores *decoded intensity fields*, which is exactly what optical flow
and the GPU path consume.

### A1 — Worker recolor pipeline (PR 1)

New files under `client/src/layers/radar/worker/`:

- **`recolor.worker.ts`** — receives `{id, blob, level, paletteId}`; does
  `createImageBitmap(blob)` → decode to intensity+presence field (port the
  palette-inversion LUT and normalized-convolution blur from `recolor.ts`, unchanged
  math) → palette-LUT to RGBA → `OffscreenCanvas` → `transferToImageBitmap()` →
  postMessage with transfer. Failure → transparent tile, never the raw tile (existing
  contract).
- **`fieldCache.ts`** (worker-side) — LRU keyed by `frameId/z/x/y` storing the decoded
  **intensity field** (Uint8Array pair: magnitude + presence), byte-budgeted (~300
  tiles ≈ 160 MB ceiling → tune down; fields are 2×512² bytes = 512 KB each, so budget
  ~120 MB → ~240 tiles; revisit with telemetry). Palette switch = re-LUT from cache:
  zero network, zero decode.
- **`pool.ts`** — 2 workers, requests hashed by tile key; per-request cancellation (a
  superseded frame's pending tiles are dropped).

Because **we fetch the blob ourselves** (`Cesium.Resource.fetchBlob`, which keeps
Cesium's request throttling) and decode in the worker, the ImageBitmap pre-flip
workaround in `recolor.ts` (`drawSourceUpright`) disappears — the worker controls
orientation end to end.

Main-thread fallback: keep the current synchronous path (existing `recolor.ts`) behind
`if (!window.OffscreenCanvas)`.

### A2 — Two-layer ping-pong (PR 2)

Rewrite `RadarLayer.tsx`'s imagery management (the component's mounting contract,
gating on `layersStore.active.radar`, and standalone use on the crisis share page all
stay identical):

- **`PingPongLayers.ts`** — owns exactly two `ImageryLayer`s backed by a
  `RadarFrameProvider` (subclass of `UrlTemplateImageryProvider`): layer **A** shows
  the current frame at target alpha; layer **B** loads the incoming frame at alpha 0.
- **Frame advance**: mutate B's frame closure → `B.imageryProvider._reload?.()` → wait
  for B's in-flight tile counter to reach zero (counted inside our `requestImage`
  override — there is no public "layer ready" event) → rAF alpha tween B 0→target over
  `FADE_MS` → `imageryLayers.raise/lower` to swap roles (reordering never refetches) →
  point the now-hidden layer at the next frame and reload it behind the opaque one.
- **Scrub**: pause playback (existing behavior), point B at the scrubbed frame; with a
  warm cache the settle is near-instant, then snap alphas. Scrubbing across many frames
  coalesces (only the latest target loads).
- **Manifest rotation**: no teardown. The timeline array updates; the visible pair is
  untouched unless its frames expired.
- **Contracts preserved verbatim**: `addImageryBelowLabels` insertion, explicit
  `viewer.scene.requestRender()` after every visual change (`requestRenderMode` is on),
  `viewer.isDestroyed()` guards on every async/rAF/worker-completion path, idempotent
  effects under React StrictMode double-mount.

### A3 — Loop warming + prefetch (PR 3)

- **`prefetch.ts`** — enumerate visible tiles via public API (camera
  `computeViewRectangle` → tiling-scheme tile range at the layer's current level; do
  not depend on `globe._surface` internals), then warm every timeline frame × visible
  tile through the worker pool into the field cache. Priority: playhead-adjacent frames
  first. Re-warm on debounced `moveEnd` and on manifest updates.
- **radarStore**: add `loopReady: number` (0–1). Play button renders a progress ring
  until ready (≥90% warmed), then autoplay. `buildTimeline`/`nowIndex` signatures and
  the `RadarFrame` shape are a public interface (`EarthTimeBar` subscribes) — extend,
  don't break.
- **RadarTimeline**: add the buffered-loop indicator; scrub/pause behavior unchanged.

### A4 — Pruning + polish (PR 4, gated on Stage 0 results)

- Set `RADAR_MAX_LEVEL` per Stage 0 (expected 7) so we stop requesting tiles the CDN
  no longer serves.
- Prune dead modes (Clouds/Combined, upstream nowcast) if confirmed dead — controls
  simplify to palette + window + opacity + play.
- Add the radar **legend** via the `layerLegends` registry (static storm-ramp entry —
  automatically appears on the main app and crisis share page).
- Feature flag: `radarEngine=v2` (localStorage + `?radar=v2` query param), v1 path kept
  for one release as the kill switch.

### Stage A acceptance

- First radar pixels < 2 s at a typical regional view on warm CDN (vs. baseline).
- Zero radar-attributable long tasks (> 50 ms) during steady playback.
- Palette switch < 100 ms with zero network requests.
- Manifest rotation produces no visible blanking/teardown.
- Crisis share page renders radar identically (manual pass), keyless, client-fetched.
- Context-loss drill: force `webglcontextlost` (via extension) — no crash, clean rebuild.

---

## Stage B — GPU spike (~4–5 dev-days, go/no-go)

Goal: prove the custom render path before Stage C commits to it. Prototype behind
`?radargl=1`, never merged to default-on.

**Primary architecture**: a view-region `RectangleGeometry` primitive with
`EllipsoidSurfaceAppearance` and a custom `Material` whose fabric takes
`{frameA, frameB, flow, t, lut}` — the worker assembles equirect composites of the view
region from cached intensity fields (4096–8192 px wide on desktop; 4096 cap and/or 2×2
split on mobile GPUs). The fragment shader decodes intensity, applies the warp (Stage C;
identity in the spike), maps through the 1-D LUT texture, and outputs per-pixel alpha.

**The known hard problem — label ordering**: primitives render above all imagery,
including the place-label overlay, and "labels stay above weather" is a house rule. The
intended resolution is the **altitude hybrid**: the label overlay already fades with
camera height (`LABELS_FADE`, ~55–80 km); use the GPU primitive only above the altitude
where labels are faded/gone, and the Stage A ping-pong tile layers (below labels)
underneath that altitude, with a crossfade handover.

**Spike acceptance (go/no-go checklist)**:
1. Draped material renders correctly at multiple altitudes/latitudes, ≥55 fps on an
   integrated GPU, with two 4096-wide textures + LUT.
2. Texture update path (swap `ImageBitmap` sampler uniforms per keyframe) doesn't leak
   GPU memory and survives a context-loss/recreate cycle with `isDestroyed` discipline.
3. The altitude handover between primitive and tile layers is visually seamless, and
   labels remain legible per the house rule at every altitude.
4. Correct compositing against all basemaps (dark/light/satellite/earth/topo) and with
   the day/night terminator lighting.

**If no-go**: Stage C falls back to *worker-composited* warp frames — the warp-dissolve
runs in the worker on the equirect composite at reduced cadence (~30 fps view-region
updates) feeding a single frequently-updated imagery layer. Lower ceiling, same visual
idea; decision recorded here with the measured reasons.

## Stage B verdict: NO-GO on the draped primitive

**Recommendation: take the worker-composite fallback.** The blocker is
architectural, not performance — which is why more frame-rate measurement would
not change the answer.

### The decisive finding: the altitude hybrid is inverted

The plan proposed running the primitive "only above the altitude where labels are
faded/gone", on the assumption that labels fade out as you zoom out. They do the
opposite. `labelAlphaAt` in `CesiumGlobe.tsx` returns **0 below `LABELS_FADE.near`
(55 km)** and ramps to **1 at `far` (80 km)**: labels are invisible close in and
fully visible zoomed out.

Cesium primitives draw above all imagery, including the label overlay, and
"labels stay above weather" is a house rule. So the only altitudes where a
primitive may legally draw are **below ~55 km** — city scale. Animated
precipitation is watched at regional and continental scale, which is precisely
where the primitive is forbidden. The GPU path would buy smooth motion in the one
regime nobody animates radar in.

Everything else follows from that:

- **The 4096-texture criterion is unreachable in the permitted band.** Below
  55 km the view spans a fraction of one level-7 tile, so the composite planner
  produces a 512×512 or 1024×1024 block. Measured: `regionKey 7/30/49/1/1`,
  262 144 px, 2.1 MB of texture. Two 4096-square textures only appear if the
  ceiling is lifted past the point where labels are visible.
- **Compositing is per-keyframe CPU work proportional to region area**, which the
  imagery path does not have at all: 445–765 ms per pair for 0.26–1.0 MP here.
  That is a software rasterizer in a container and would be far quicker on real
  hardware, but the *shape* of the cost — O(region) per keyframe, on top of the
  decode the imagery path already does — is inherent.
- **The composite and the field cache are awkwardly coupled.** The GPU path needs
  exactly the tiles the imagery path decoded, and has no authoritative handle on
  which those are. Three derivations were tried — camera view rectangle, deepest
  observed level, current display level — and all three produced empty composites
  while the camera was moving, because they name tiles Cesium has not requested.
  Solvable (drive compositing from the imagery layer's own tile set, or give the
  compositor its own decode path), but it is real work the plan did not budget.

### What did work, and is worth keeping

- The custom `Material` fabric **compiles and renders**: no shader compile or link
  errors, correct drape via `EllipsoidSurfaceAppearance` on `RectangleGeometry`,
  the palette LUT matching the CPU path, per-pixel alpha, and the mercator
  reprojection of a latitude-linear `st`.
- **Texture swapping is leak-free.** Cesium destroys a material's old GPU texture
  only after the replacement uploads (`Material.update`), and the spike retires
  its own `ImageBitmap`s three rendered frames after handover: 134 retired,
  `bitmapsOutstanding` back to 0.
- Promoting the outgoing B composite into the A slot on a playhead step **halves**
  the composite work per frame advance (measured 41 reuses across 138 swaps).
- Blending magnitude and presence separately and dividing afterwards — the
  normalized convolution carried into the time axis — is the right shape for
  Stage C and survives unchanged into the fallback.

### Not measured here

Frame rate, GPU memory under real drivers, compositing against the live basemaps
and the day/night terminator. This sandbox renders through SwiftShader (measured
2.1 fps, meaningless) and its basemap CDNs are blocked. The harness is shipped —
`?radargl=1` plus `window.__radarGl()` — so these can be read off real hardware
if the verdict is worth contesting. Given the label-ordering finding, they would
have to be extraordinary to change it.

### Stage C PR 5 — optical flow in the worker (landed)

`flow/lk.ts` is dense pyramidal Lucas-Kanade over the cached intensity fields:
3-level pyramid, per-cell solve over a 13×13 window, Tikhonov regularization
scaled to the window's own gradient energy, confidence-weighted smoothing, and a
3×3 median per level. Pure typed arrays, no dependencies.

**Deviations and decisions**

- **Windows are normalized to zero mean and matched energy.** Textbook LK
  assumes brightness constancy, which radar breaks constantly — cells intensify
  and decay in place. Before this, a blob growing 30% while standing still
  reported ~4 px of spurious travel; after, **0.01 px** of net translation. This
  is the plan's "flow artifacts on growth/decay" risk, closed at the source
  rather than mitigated downstream.
- **Gradients are precomputed per pyramid level** and cell centres snap to whole
  pixels, so only the target frame needs bilinear sampling. Cost fell from
  **256 ms to 62 ms** per 256² pair — comfortably inside the plan's 30–300 ms.
- **Flow is solved from a merged mosaic, not per worker.** Tiles are hashed
  across workers so a tile's whole time series stays together, which means no
  single worker holds a complete region. Each worker returns its own downsampled
  partial; because the shares are disjoint and absent tiles read as zero (as does
  empty sky), a per-pixel maximum merges them. The merged planes are then
  *transferred* into one worker for the solve, so the hand-off is a pointer, not
  a copy.
- **`planWarmRegion` replaces `planRegion` for flow.** "What is on screen" and
  "what can be measured" are different questions: the level Cesium most recently
  requested may have nothing decoded yet, and flow measured from holes is worse
  than no flow. This walks the observed levels finest-first and returns the
  deepest one whose tiles are genuinely warm for *both* frames. It is also the
  fix for the empty composites the Stage B spike hit.
- **Flow is cached per pair per region.** A 13-frame loop is 12 pairs, revisited
  every few seconds by playback; the frames are historical, so the answer cannot
  change.

**Verified** — 15 checks in a synthetic harness plus one end-to-end browser run:

| Check | Result |
|---|---|
| Pure translations (4–24 px, five directions) | recovered within **0.07–0.89 px** |
| Growth in place (r ×1.3, amp ×1.35) | **0.01 px** net translation, peak 0.77 px |
| Decay in place (r ×0.75, amp ×0.7) | **0.02 px** net translation, peak 1.21 px |
| Identical frames | exactly zero |
| Opposing halves (±10 px) | signs correct, −8.94 / +9.98 |
| Empty field | finite, all-zero, no NaNs |
| Confidence over echo vs empty sky | 0.33 vs 0.00 |
| Cost per 256² pair | **62 ms** (128²: 34 ms) |
| End-to-end through decode → cache → merge → solve | expected (5.12, 2.56), got **(5.01, 2.62)** |

A diagnostic ships behind `?radarflow=1` (`window.__radarFlow()`), because flow
lands one PR before anything draws it and a wrong field would otherwise first
appear as a broken warp.

### Stage C PR 6 — the warp-dissolve (landed)

`flow/warp.ts` is a backward (semi-Lagrangian) warp: for each output pixel, pull
from where the echo *was* in A (back along the flow by `t`) and where it *will
be* in B (forward by `1−t`), then blend. Backward rather than forward because a
forward scatter leaves holes wherever the flow diverges. Magnitude and presence
are blended separately and divided after — the normalized convolution carried
into the time axis, so echo growing or fading between frames stays truthful
instead of ghosting.

With `flow` null or all zeros this reduces **byte-for-byte** to the Stage A
dissolve (asserted, not assumed), which is what makes it the permanent fallback:
flow failure, an undecoded region, and `prefers-reduced-motion` all land there
with nothing special to do.

**Deviations and decisions**

- **The warp is region-scoped, not per-tile.** It routinely pulls pixels from
  across a tile boundary, so a per-tile warp would seam at every edge. It runs
  over the same stitched block `composite.ts` already plans.
- **Tiles are now hashed to a worker by ZOOM LEVEL** (`worker/pool.ts`). A region
  is single-level by construction, so this guarantees one worker holds the entire
  region for every frame — stitch, flow and warp all read straight from its own
  cache instead of being gathered and merged across workers. The cost is that
  decode for the on-screen level lands on one worker; that is not the bottleneck,
  because tile fetches are throttled to two at a time and the network gates
  warming long before the decode does.
- **Rewritten allocation-free** after the first cut measured 536 ms/megapixel —
  `sampleFlow` returned a tuple per pixel. Inlining the bilinear sample and
  resolving the coarse flow grid to full resolution once per pair brought it to
  **61 ms/MP**.
- **Region reply bitmaps are now closed on the cancelled path.** A composite or
  warp reply arriving after its job was cancelled leaked its `ImageBitmap`; at a
  full 8×8 block that is 67 MB apiece.

**Verified** — 20 checks in a synthetic harness plus a browser run on the tile
fixture:

| Check | Result |
|---|---|
| `t=0` / `t=1` reproduce frames A and B exactly | centre within **0.0 px**, single lobe |
| Broad front (r22, 24 px step): storm at the midpoint | **96.7** vs 96.0 expected, one lobe |
| …warp stays as sharp as a real frame | core **45 px**, identical to a source frame |
| …the dissolve smears it | core **53 px**, and peak alpha 210 vs 254 |
| Compact cell (r6, 20 px step): dissolve ghosts | **2 lobes** — the double exposure this replaces |
| …warp shows one cell, full strength | 1 lobe, peak **246 vs 103** |
| Monotonic advance across `t`, both scenes | no reversals, no step past 1.1× even spacing |
| Zero flow vs plain dissolve | **byte-identical** |
| `flipY` output | exact vertical mirror |
| Cost | **61 ms/megapixel** (3.3 ms for 192²) |
| Browser: endpoints vs dissolve | delta exactly **0** at both ends |
| Browser: interior vs dissolve | mean **5.7** alpha levels over covered pixels, peak 33 |
| Browser: divergence profile | 4.8 / **5.7** / 4.8 — peaks mid-interval, as motion must |
| Browser: cost per warped region frame | **71 ms** peak (1024² block, SwiftShader) |

**The tracking limit, stated rather than discovered later.** What governs the
warp is displacement ÷ feature radius, not pixels. A window can only measure
motion it sees in *both* frames, so once an echo travels much past its own
radius its two positions no longer overlap and nothing links them. Measured on a
22 px blob: ratio ≤2.0 is exact (≤0.4 px), ~2.4 drifts a few px, ≥3.2 breaks
down into a ghost. Real frames sit well inside that — 10–25 px per 10-minute
step at regional zoom against features tens of pixels across. Past the limit the
warp degrades *toward the dissolve* rather than inventing anything: asserted that
it never renders brighter than a source frame and never places mass outside the
span the storm actually travelled.

A diagnostic ships behind `?radarwarp=1` (`window.__radarWarp()`). It reports how
far the warp departs from a crossfade of the same pair, averaged over the pixels
either render covers — **not** over the image, because a view is mostly empty sky
where both are identical, and that denominator reports a number that shrinks as
you zoom out while saying nothing about whether the storms moved. Zero divergence
in the interior looks exactly like "the weather is not moving", which is the
failure this exists to catch.

Nothing draws the warp yet: `t` becomes continuous in PR 7, which is where the
render wiring belongs.

### Stage C PR 7 — continuous timeline, and the warp on screen (landed)

`radarStore.position` is a float index into the timeline; `currentIndex` remains
as its round, because warming, the Stage A tile path and engine v1 all want a
single frame. Both setters write both fields, so the two can never disagree.
`buildTimeline` and `nowIndex` are untouched — `EarthTimeBar` subscribes to them.

Playback advances the playhead on an animation frame instead of stepping an
index on a timer, at 0.5×/1×/2×. The timeline handle is continuous and its
readout interpolates.

`motion/WarpRegionLayer.ts` puts the warp on the globe: **one** imagery layer
pinned to exactly the region, via a `WebMercatorTilingScheme` with a 1×1
level-zero grid whose bounds are the block's own mercator corners. The block IS
the level-zero tile and the composite IS its pixels, so nothing is reprojected on
the way to the screen. Below labels, like everything else.

**Deviations and decisions**

- **A float index, not minutes-relative-to-now.** Every consumer wants a frame
  pair and a mix; `floor` and `fract` give both directly, where a time needs a
  search. `framePairAt` clamps rather than extrapolating past the last frame —
  extrapolation is a forecast and has to be labelled as one (PR 8), so warping
  past the end would present invented weather as observed.
- **Scrubbing stands motion down.** The house rule is that the frame under the
  handle is the frame on screen, immediately; a warp costs tens of milliseconds.
  A drag renders from cached tiles and stays instant. Pointer-*cancel* clears the
  flag too — without it a drag interrupted by a browser gesture leaves motion
  off for good.
- **`present` drives renders until the globe takes the image.** `requestRenderMode`
  means the globe will not render on its own, and a tile reload only advances
  while it renders. One `requestRender()` after the reload is not enough — the
  tile's state machine needs several passes — and without this the serve
  reliably expired instead. Same pattern as `PingPongLayers.waitForSettled`.
- **The region in use is preferred over the best one available** (new
  `regionWarmth`). `planWarmRegion` returns the *deepest* warm level, and which
  level qualifies differs from pair to pair, so re-planning on each pair flipped
  the region back and forth while the camera sat perfectly still — each flip a
  layer teardown and rebuild. Slightly coarser weather that holds still beats
  sharper weather that flickers.
- **The serve valve is 2 s, not 400 ms.** Near the frame time it made a slow
  device queue a second warp before the first was drawn — the back-to-back
  reload hazard, plus wasted worker time. At 400 ms a third of all presents
  expired on the software renderer.
- **Handover is ordered to overlap, never gap**: show the warp before dimming the
  tiles, restore the tiles before hiding the warp. A frame where both draw is a
  momentary brightening of the same weather; a frame where neither draws is a
  hole in it.
- **Blocks are capped at 4 tiles a side for motion** (2048², 16 MB an upload),
  against `composite.ts`'s 8 for the Stage B spike. A warped frame is re-uploaded
  as a whole texture every time it changes, so block size is a per-frame
  bandwidth cost rather than a one-off.

**Verified** — browser runs against the tile fixture:

| Check | Result |
|---|---|
| Two positions in one interval, stepping path | **byte-identical** screenshots — it cannot tell them apart |
| Two positions in one interval, motion path | **different** — the storm has moved |
| Motion engages and holds | `showing`, 16–28 warps per run, 27–82 ms each |
| Handle advance | 8 distinct positions across 8 samples — continuous, not stepped |
| Speed control | 2× / 1× ratio **2.00**, 0.5× / 1× ratio **0.53**, strictly ordered |
| Imagery layers on the globe | **5** — basemap, labels, two tile layers, one motion layer |
| Region stability, camera still | **0** rebuilds (was flipping before `regionWarmth`) |
| Scrub | stands down mid-drag, returns after release |
| Presents reaching the globe | 12 of 19; the rest are the valve pacing to a 1.6 s frame time |

**What this sandbox cannot measure.** It renders through SwiftShader at roughly
one frame per 1.6 s — measured **identical with `?radarmotion=0`**, so that is
the software renderer and not this feature. Two consequences are visible in the
numbers above and would not appear on real hardware: the advance cap makes
playback run ~16% slow (a frame longer than a whole interval loses the
remainder, deliberately), and a quarter of presents hit the serve valve. Both
are the design working as intended under a frame time it was never going to see
in a browser with a GPU. Absolute frame rate and texture-upload cost still need
a real device.

The first thing to check on real hardware is whether `T_STEPS = 16` is the right
granularity — it caps motion at about 20 renders a second, which is a guess, not
a measurement.

### Stage C PR 8 — advection nowcast (landed)

`flow/advect.ts` is Lagrangian persistence: the newest observed field carried
forward along the measured flow by backward integration, substepped so a curved
trajectory curves, with a gentle intensity decay for lead time. It is the
standard short-range radar nowcast and the baseline pysteps and rainymotion use.

One rule separates observed from forecast, and it is the clock rather than which
frames a pair happens to name: where is the playhead in TIME relative to the
newest observation? Before it, two real frames bracket the moment and PR 6's warp
interpolates. After it, there is no second frame to reach toward, and the only
honest thing to draw is an extrapolation of the last one. Deriving it from time
keeps the boundary continuous — the last observed frame is lead 0, and the
playhead slides off the end of the record without a seam.

**The honesty contract.** The hazard the design had to answer: with the playhead
in the forecast zone and motion standing down, whatever the tile path shows
underneath would be the last OBSERVED frame while the readout says "forecast
+20 min". The resolution is that **the tile path renders forecast frames empty**.
There is no state in which observed pixels can be on screen while the playhead
names a forecast time, because the only thing that can draw a forecast is the
region layer. Empty is legible; the hatch fades, the readout says "forecast
unavailable", and nothing drawn contradicts it. Where nothing could ever draw a
forecast — engine v1, `?radarmotion=0`, reduced motion — the zone is *absent*
rather than present and empty.

**Deviations and decisions**

- **Flow must be DENSIFIED before it can be extrapolated along.** LK only knows
  the motion of things it can see; over empty sky it returns near-zero at
  near-zero confidence. That is fine for the warp, which only samples where the
  echo already is, and fatal for a forecast, which traces backwards from a spot
  that is currently empty. Against a raw field the trace starts in a zero-flow
  cell, never travels, and reports empty sky forever — a storm bearing down on a
  city simply never arrives. Measured on a known 18 px/frame track: +1 landed
  7 px short, +3 landed 27 px short, and the echo tore apart. Spreading the
  measured vectors outward by normalized convolution fixes it.
- **The spread weights cells by confidence SQUARED above a floor.** A cell
  straddling a storm's leading edge half-sees the motion and honestly reports a
  smaller vector; enough of those averaged in linearly drag the answer below the
  truth — worth 5–8 percentage points of advected speed, and another 5 for
  including cells below the floor. Widening or narrowing the spread radius was
  measured and made things worse in both directions.
- **A back-trajectory that leaves the region renders TRANSPARENT**, where the
  warp clamps to the border. There the edge value is real — both frames cover
  the same ground. Here it is not: upwind of the boundary there is no data, and
  replicating the edge row would paint a rain shield stretching off the side of
  the forecast. Invented weather is the one thing a forecast may not do.
- **Lead times are +10/+20/+30 with a +60 ceiling.** Persistence assumes storms
  neither grow, decay nor turn; that holds for the first half hour and decays
  badly after an hour.
- **The decay is about confidence, not physics.** Persistence does not predict
  that rain weakens and pysteps applies none. It is there because a forecast
  drawn at exactly the strength of an observation claims to know as much as one.
- **Forecast frames are anchored to the newest observed frame's time**, not the
  wall clock, so a stalled feed pins the forecast to the last thing actually seen
  instead of drifting into a future built on nothing.
- **The readout names the method** — `advection +29 min`, with a tooltip saying
  it cannot predict storms forming, dying or turning. "Forecast" alone reads like
  a meteorologist's product.

**Verified** — 13 synthetic checks plus 10 in the browser:

| Check | Result |
|---|---|
| Lead 0 reproduces the observed frame | exact |
| +1 / +2 / +3 direction | cosine **1.0000** at every lead |
| +1 / +2 / +3 distance | **88% / 88% / 87%** of true — a steady, conservative bias |
| Ground the storm vacated | **0** lit pixels — nothing smeared |
| Upwind border | **0** lit pixels — nothing invented |
| Decay | lowers intensity, moves the storm 0 px |
| No flow | persistence in place, unmoved |
| **Beats persistence against a HELD-OUT observed frame** | error **1.58 vs 6.09** — **74% better** |
| Cost | **185 ms/megapixel** at lead 3 |
| Browser: forecast zone appears after "now" | hatch at 62.5% |
| Browser: playhead past "now" renders an extrapolation | lead 29 min, `forecast: true` |
| Browser: the forecast draws real weather | **13.9%** of the view is echo |
| Browser: forecast vs observation | different images, comparable echo (13.9% vs 16.4%) |
| Browser: readout | reads `advection +29 min` |
| Browser: motion disabled | **no forecast zone offered at all** |

The held-out check is the plan's acceptance criterion ("sanity-checked against
the next observed frames") made numeric: measure flow from frames 0 and 1 only,
forecast frame 2, and score against the real frame 2 the measurement never saw,
against the null hypothesis that nothing moves.

**Two bugs this PR shipped and then fixed, both worth recording.**

The first is the reason for the honesty framing above. The worker built its flow
grid without a confidence plane, because the warp does not read one. The nowcast
does — `densifyFlow` weights by it — so every vector densified to NaN, and a NaN
back-trajectory fails its own bounds check (`NaN < 0` is false). Nothing threw,
nothing logged, and **the forecast rendered completely empty while every status
field reported success**. The browser test in place at the time passed, because
it asserted only that the forecast image *differed* from the observed one — and a
blank image differs from anything. Both were fixed: confidence is now a required
field of a shared `FlowGrid` type (which turned the bug into three compile
errors), `densifyFlow` refuses a mismatched plane loudly, and the test now counts
weather-coloured pixels instead of comparing hashes.

The second: the full-resolution flow expansion cached on OBJECT IDENTITY, which
can never hit across a `postMessage` — structured clone hands the worker a fresh
object every message, so it re-expanded a million-pixel field for every frame it
drew. Keying on a stable token took warp cost per frame from 69–78 ms to **43**.

**What still needs real hardware.** Everything the PR 7 section lists, plus the
advection bias: the 87–88% figure is measured on a synthetic Gaussian storm
travelling about its own radius per frame, and real convective fields have finer
structure that LK tracks better (the smaller-feature case measured 95–99%). The
honest expectation is between those, and it is conservative in the safe
direction — the forecast puts a storm slightly short of where it will be — but it
has not been scored against real radar.

### What Stage C takes forward

The fallback keeps weather **below labels at every altitude**, which is the house
rule the primitive cannot satisfy. It reuses the Stage A ping-pong and the field
cache unchanged, and `composite.ts`'s mercator stitch is directly reusable — the
warp runs in the worker over the same block and the result feeds an imagery
provider instead of a material. `WeatherMaterial`'s GLSL becomes the reference
for the worker-side warp math rather than dead code.

---

## Stage C — Motion (~10–15 dev-days)

### C1 — Optical flow in the worker (PR 5)

- **`flow/lk.ts`** — dense pyramidal Lucas-Kanade over two *blurred, downsampled*
  luminance mosaics of the view region (256–512 px): 3-level pyramid, per-block LK with
  regularization, median-filter + clamp outliers, output a coarse flow grid (64×64 or
  128×128, RG float) bilinearly upsampled in the shader. Pure JS/typed arrays first
  (radar fields are smooth and low-texture — this is the easy case for LK); WASM-SIMD
  port only if profiling demands it. **No opencv.js** (8 MB dependency for one function).
- Budget: one frame-pair ≈ 30–300 ms in the worker; the full window computes
  progressively behind playback; cache per pair keyed by `frameIdA/frameIdB/region`.
- Prior art to consult (not vendor): pysteps/rainymotion LK parameters,
  jpettitt/weather-radar-card's worker LK (license check before reading code).

### C2 — Warp-dissolve shader (PR 6)

Material GLSL: sample flow `F`, warp A backward by `t·F` and B forward by `(1−t)·F`,
`mix` the decoded intensities, LUT-colorize, per-pixel alpha; blue-noise dither to avoid
banding on the soft gradients. `flow = 0` degrades to the exact Stage A dissolve — that
is the permanent fallback (flow failure, low-power devices, reduced-motion preference).

### C3 — Continuous timeline (PR 7)

- `radarStore` time becomes a float (minutes relative to "now"); `buildTimeline` and
  `nowIndex` remain exported with compatible semantics for `EarthTimeBar`.
- `RadarTimeline`: continuous handle, fluid scrub (any `t` renders in < 16 ms from
  cached textures), playback-speed control (0.5×/1×/2×), forecast zone hatched as today.
- The stepped fallback (Stage A path at deep zoom or fallback mode) snaps `t` to
  keyframes — one timeline component serves both.

### C4 — Advection nowcast (PR 8)

- Extrapolate the newest observed frame forward along the latest flow field
  (semi-Lagrangian backward sampling), generating synthetic keyframes at +10/+20/+30
  min (out to +60 max — advection credibility drops after that), with a mild intensity
  decay with lead time.
- UI: frames beyond "now" render in the hatched zone with the existing amber
  FORECAST treatment; label the mode "advection forecast" in the timeline readout.
- If Stage 0 found upstream nowcast alive after all, prefer upstream frames and
  interpolate through them with the same machinery.

### C5 — IEM CONUS source (PR 9, gated on Stage 0.2)

- **`radarSource.ts`** — source abstraction: `{ id, manifest(), tileUrl(frame, xyz),
  decode(worker), coverageRect, cadenceMin }` with `RainViewerSource` (global, 10-min)
  and `IemSource` (CONUS rect, 5-min, `q2-hsr` preferred). Regional preference: IEM
  inside its coverage rectangle, RainViewer elsewhere; rectangle-clip the IEM provider
  (the `PrecipLayer` QPF pattern) so no out-of-coverage tiles are ever requested.
- This interface is deliberately the seam where Option 3's first-party MRMS source
  plugs in later — unchanged renderer, new `RadarSource`.

### Stage C acceptance

- Side-by-side A/B (dissolve vs. flow) shows visibly continuous motion; no
  double-exposure ghosting on fast-moving cells.
- 60 fps playback on mid-tier hardware; ≥ 30 fps on a mid-range phone.
- Scrub-to-render latency < 16 ms anywhere in the warmed window.
- Nowcast: +30 min shown by default, flagged as forecast; sanity-checked against the
  next observed frames (advection error visibly reasonable).
- Flow failure, WebGL loss, and `prefers-reduced-motion` all degrade to the Stage A
  dissolve with no blank layer.
- Crisis share page and `EarthTimeBar` coexistence re-verified.

---

## File map

**New** (all under `client/src/layers/radar/` unless noted):
`worker/recolor.worker.ts`, `worker/fieldCache.ts`, `worker/pool.ts`,
`PingPongLayers.ts`, `prefetch.ts`, `radarSource.ts`,
`gl/WeatherMaterial.ts`, `gl/WeatherPrimitive.ts`,
`flow/lk.ts`, `nowcast.ts`.

**Modified**: `RadarLayer.tsx` (thin orchestrator), `RadarTimeline.tsx` (continuous +
buffered indicator), `RadarControls.tsx` (speed; pruned modes), `radarStore.ts`
(float time, `loopReady`, back-compat exports), `RainViewerImagery.ts` (becomes
`RadarFrameProvider`; recolor moves to worker), `client/src/ui/layerLegends.tsx`
(radar legend), `server/src/routes/radar.ts` (Stage 0 diag extension; remove after).

**Unchanged on purpose**: `palettes.ts` (same stops feed the worker LUT and the GPU LUT
texture), `imageryOrder.ts`, crisis share components, `EarthTimeBar.tsx`.

---

## Risks

| Risk | Exposure | Mitigation |
|---|---|---|
| `provider._reload()` is private API | Stage A core | Pinned behavior test (0.3); fallback is add-new-layer-then-remove-old, which the flicker-free tile-ready tracking makes safe |
| Custom primitive vs. label ordering | Stage B/C | Altitude hybrid aligned with the existing label fade; explicit spike criterion; worker-composite fallback |
| RainViewer further degrades or dies | Whole engine | `RadarSource` abstraction from Stage C1; IEM as second source; Option 3 pipeline is the designed exit |
| Flow artifacts on growth/decay (cells that form/dissolve rather than move) | Stage C | LK regularization + blend weighting near t=0/1 keeps endpoints truthful; worst case looks like today's dissolve, never worse |
| Worker/cache memory on low-end devices | Stage A | Byte-budgeted LRU, halved budgets on `navigator.deviceMemory ≤ 4`, telemetry counter |
| GPU context loss mid-animation | All stages | Existing recovery machinery + `isDestroyed()` guards on every async path; drill in each stage's acceptance |
| StrictMode double-mount regressions | Stage A | Idempotent setup/teardown; dev-mode assertion that layer count ≤ 2 |

## Rollout

1. Each PR lands behind `radarEngine=v2` (off by default) → internal testing.
2. Stage A complete → flip v2 default-on, keep v1 for one release as kill switch.
3. Stage B verdict recorded here (go/no-go + measurements).
4. Stage C ships incrementally (flow → continuous timeline → nowcast → IEM), each PR
   individually revertible; v1 path deleted after Stage C stabilizes.

## Stage 0 results

Run against production 2026-08-12 (`GET /api/radar/diag`). Every expectation in
the plan was confirmed.

- [x] **Live manifest**: `radar.nowcast` is published but **empty** (0 frames) —
      nowcast is discontinued. `satellite.infrared` is **absent/empty** (0
      frames) — infrared is discontinued. Past radar: 13 frames, **10-minute**
      cadence, **120 minutes** of history, newest frame 5 minutes old.
- [x] **z8/z9 tile behavior**: z6 and z7 serve real, distinct mosaics (z7 vs its
      z6 parent upscaled: only 33.6% of pixels identical, mean RGB difference
      24.8 — genuine new detail). z8, z9, z10 and z11 **all return the same
      3269-byte payload** regardless of coordinate, a 4-bit paletted PNG that
      carries no radar data. **There is nothing above z7.** The client had
      `RADAR_MAX_LEVEL = 9`, so deep zooms were downloading that placeholder and
      feeding it through the palette inversion; what it rendered as is unknown
      (the sandbox cannot reach the CDN and the server-side decoder does not
      handle 4-bit PNGs), but it was never radar.
- [x] **Rate limits**: a 30-tile concurrent burst returned 30×200, **no 429s**,
      723 ms wall, 453 ms median per tile, 881 KB total. Tiles carry
      `Cache-Control: max-age=172800` (48 h), `cf-cache-status: rv_edge` and
      `Access-Control-Allow-Origin: *` — so the browser HTTP cache absorbs
      repeat requests, which is why the two ping-pong layers pointing at the
      same frame cost one download rather than two.
- [x] **IEM**: all four probes returned 200 with `Access-Control-Allow-Origin: *`
      and `Cache-Control: public, max-age=300`, 179–413 ms. `q2-hsr-900913` is
      distinct content and the fastest. **Caveat**: `USCOMP-N0Q-0`, `-m05m` and
      `-m50m` all returned byte-identical 20480-byte payloads with identical
      visible-pixel counts, so the time-slugged variants did **not**
      differentiate in this sample. Before Stage C relies on IEM for history,
      re-probe those from a browser at spaced intervals — they may be edge-cached
      or the slugs may no longer work. Usage policy is still unread.
- [x] **`_reload` spike**: verified against 1.142 source and exercised by PR 2 —
      see the version-correction notes above.
- [x] **Baseline metrics**: captured as the v1 column of each PR's table below.

**Decisions recorded**

| Decision | Outcome |
|---|---|
| `RADAR_MAX_LEVEL` | **7** (was 9) |
| Clouds / Combined modes | **Pruned** — the product behind them serves zero frames |
| Upstream nowcast frames | **Dropped as a source**; the `nowcastFrames` slot and its hatched forecast styling stay for Stage C's advection frames |
| IEM as Stage C secondary source | **Approved**, subject to re-probing the time-slug variants |

### Cesium version correction (affects the whole plan)

The plan was written against **Cesium 1.121**. The repo's `^1.121.1` range
actually resolves to **1.142.0 (`@cesium/engine` 26.0.0)**, and that is what
`package-lock.json` pins and what ships. Every load-bearing claim was therefore
re-verified against 1.142 source:

- **`_reload` exists and is better than assumed.** `GlobeSurfaceTileProvider`
  assigns `imageryProvider._reload` when a layer is added and clears it on
  removal. The reload function inserts NEW `TileImagery` skeletons after the
  existing ones and frees the old ones only once the new ones are ready
  (`getTileReadyCallback`). So the in-place frame swap is inherently
  flicker-free — the old frame stays on screen until the new one can replace it.
  Two caveats for Stage A PR 2: `_reload` is only assigned if `layer.show` was
  true at add time, and a reload SKIPS any tile that still has a pending
  loaded-callback, so rapid successive reloads need re-issuing rather than
  fire-and-forget.
- **Toggling `show` really is a full teardown**: `_onLayerShownOrHidden` calls
  `_onLayerAdded`/`_onLayerRemoved` outright. Alpha stays the only safe knob.
- **`readyPromise` is gone**, and there is still no public "layer ready" event.
- **`Resource.fetchBlob` returns `undefined` when throttled**, exactly like
  `fetchImage`. Imagery requests are created with `throttle: false,
  throttleByServer: true`, so the undefined case is real (the per-server slot
  limit) and `requestImage` must propagate it synchronously.
- **The handoff's "a globe tile is not renderable until ALL layers' imagery is
  ready" is WRONG for 1.142.** `GlobeSurfaceTile.processStateMachine` computes
  `isAnyTileLoaded` and sets `tile.renderable = tile.renderable &&
  (isAnyTileLoaded || isDoneLoading)` — "allow rendering if any available layers
  are loaded". So one slow or stuck imagery layer does NOT hold up the tile,
  which is why the two-layer ping-pong does not delay first paint. The corollary
  still bites, though: a tile with NO layer's imagery ready is not drawn at all,
  so where radar is the only imagery layer (as in the headless harness, whose
  basemap CDN is blocked) a stuck radar tile shows as bare globe.
- **`UNPACK_FLIP_Y_WEBGL` is ignored for `ImageBitmap` sources.** Cesium
  compensates by decoding imagery with `imageOrientation: 'flipY'` and
  `premultiplyAlpha: false`. Anything handing Cesium a bitmap must match that
  convention or every tile renders mirrored. This is why `colorizeField` writes
  its rows bottom-up (canvas sources, i.e. the v1 fallback, are flipped at
  upload instead and must NOT be pre-flipped).

## Stage A results

### PR 1 — worker recolor pipeline (landed)

**Deviations from the plan, and why**

- **`radarField.ts` lives at `layers/radar/`, not under `worker/`.** It is
  shared math: the worker and the v1 main-thread fallback both drive it, so
  there is exactly one definition of the palette inversion and the blur
  schedule. `recolor.ts` now imports from it instead of duplicating the anchor
  table.
- **The blur is three box passes, not a canvas `filter: blur()`.** `ctx.filter`
  is unavailable/slow in a worker, and the SVG filter spec defines
  `feGaussianBlur` in terms of exactly this three-box approximation — so this is
  what the main-thread path was already computing. Measured against a true
  Gaussian on a clamped-edge disc: max error 3.0/255 at σ=1.5, 5.8 at σ=2.0, 5.1
  at σ=4.0, mass preserved within 0.06%. Running sums make it O(1) per pixel
  instead of the ~25-tap kernel σ=4 would need.
- **No snow plane in the cached field.** The served palette carries no snow
  signal (the v1 snow branch is already dead code), so the field is the planned
  magnitude+presence pair with nothing wasted.
- **Two watchdogs were added that the plan did not call for.** Justified below.

**The hang that forced the watchdogs.** Under stress, a worker occasionally
stopped answering: one run had worker 0 resolve 0 tiles, another had worker 1
resolve 25 of 30 and then stall. Because the worker drains its queue serially, a
single `createImageBitmap` that never settles strands every tile routed to that
worker. Cesium leaves those tiles in TRANSITIONING and never retries, so radar
goes missing there for the rest of the session; in the harness — where the
basemap CDN is blocked and radar is the only imagery layer — the affected globe
tiles were not drawn at all, which is how it surfaced as a blank globe. Two
bounds now make that impossible:

- worker side: each decode/encode is raced against `DECODE_TIMEOUT_MS` (8 s) so a
  hung call throws instead of wedging the queue;
- main-thread side: every job is bounded by `TILE_TIMEOUT_MS` (15 s), covering a
  genuinely dead worker or a dropped `messageerror`, and rejecting into the
  existing "degrade to a transparent tile" contract.

Reproduced on the production build before the fix; 8/8 clean after.

**Measured (headless Chromium against synthetic RainViewer-palette tiles, since
the sandbox cannot reach the real CDN):**

| Check | v1 | v2 |
|---|---|---|
| Palette switch → network tile requests | **36** | **0** |
| Globe render vs v1 (differing pixels, globe region) | — | **0.67%**, mean 0.61/255 (terminator drift between runs) |
| Blank/partial globes over 8 consecutive loads | — | **0** |

The zero-network palette switch is the criterion this PR exists to hit: v1 tears
down and refetches the whole layer stack, v2 re-runs the LUT over cached fields.

**Still open for later PRs**: first-radar-pixel timing and long-task counts
during playback.

### PR 2 — two-layer ping-pong (landed)

`PingPongLayers` owns exactly two `ImageryLayer`s and walks them through the
timeline; `RadarFrameProvider` gained a mutable frame/palette plus an in-flight
tile counter. `RadarLayer` is now a chooser: `RadarLayerV1` is the old
stack-per-frame implementation, kept verbatim as the kill switch, and
`RadarLayerV2` is a thin orchestrator over the pair. The pair is created on
`[viewer, active, host]` only — frames rotating, the window changing and the
palette changing all flow through the existing pair.

**Deviations**

- **v2 covers the plain radar mode only**; Clouds/Combined still run the v1
  stack. Both are built on RainViewer's infrared product, which Stage 0 is
  checking still exists — porting a product that is about to be pruned would be
  wasted work, so PR 4 decides.
- **No per-tile cancellation of Cesium-driven requests.** Cancelling would leave
  the imagery promise unsettled, which is precisely the hang PR 1 had to bound.
  Superseded tiles are allowed to finish instead (they are cheap, and the field
  cache keeps them useful). `cancelTile` stays for PR 3's prefetch, where
  nothing is waiting on the result.
- **Teardown drains its own waiters.** `destroy()` cancels the rAFs that would
  have resolved an in-flight transition, so the promises are resolved explicitly;
  otherwise `pump` parks forever holding the viewer and both layers alive, and
  StrictMode's double-mount leaks one per mount in dev.

**Measured** (same harness):

| Check | v1 | v2 |
|---|---|---|
| Imagery layers for a 6-frame timeline | 6 (one per frame) | **2** (asserted in dev) |
| Distinct frames' tiles fetched to display ONE frame | 6 of 6 | **3 of 6** — only frames actually shown |
| Tiles refetched by a manifest rotation | **42** (full teardown + rebuild) | **6** (the one new frame) |
| Network tiles during a second playback loop | 0 | 0 |
| Same scrubbed frame rendered vs v1 | — | **0.09%** differing pixels |
| WebGL context-loss drill | — | **recovers, radar repaints** (chroma 0.62 vs 0.64 before) |

The rotation number is the one that matters: v1 tears the whole stack down and
re-downloads every frame every two minutes, forever. v2 keeps its two layers and
pays only for the frame that is genuinely new.

### PR 3 — prefetch + loop warming (landed)

v1's one genuine virtue was instant scrubbing: a layer per frame meant every
frame was already downloaded. v2 loads lazily, so the replacement is a warmed
horizon — `prefetch.ts` decodes every timeline frame's copy of the visible tiles
into the worker field cache, nearest-the-playhead first, and playback waits for
it. `radarStore` gained `loopReady` (0–1) and `LOOP_READY_THRESHOLD`; the
timeline shows a conic progress ring on the play button and a buffered bar on
the track.

**Deviations**

- **The visible tile set is observed, not derived.** The plan called for
  `camera.computeViewRectangle()` → tiling-scheme tile range at the layer's
  current level. The level part of that means reimplementing Cesium's private
  `_getLevelWithMaximumTexelSpacing` and keeping the copy in step with it
  forever, and a mismatch would silently warm the wrong keys. `visibleTiles.ts`
  instead records the coordinates Cesium actually requests, which is exact by
  construction and needs no private API. Entries age out after 90 s so panning
  away stops warming tiles nobody is looking at.
- **Warm fetches go through `RequestScheduler` with `throttle: true`**, unlike
  visible imagery (`throttle: false`). Warming therefore loses the priority
  contest to tiles someone is looking at, and a declined fetch just backs off.
  Concurrency is additionally capped at 2 and paused entirely while either
  visible layer has tiles outstanding.
- **Playback has a warm-wait safety valve** (`WARM_WAIT_MS`, 8 s). Two deadlocks
  are otherwise reachable: a plan built before Cesium has requested anything is
  empty, holds `loopReady` at 0, and — because playback waits on it — never
  produces the playhead change that would re-plan; and warming that stalls for
  any reason would freeze the timeline entirely. Radar that plays while still
  filling in is strictly better than radar that refuses to play, which is what
  v1 did anyway. The prefetcher also re-plans on its backoff rather than merely
  resuming, which closes the first deadlock at the source.

**Measured**:

| Check | v1 | v2 |
|---|---|---|
| Network tiles from scrubbing the entire track after warm | 0 | **0** |
| Frames warmed | 6 of 6 | 6 of 6 |
| Total tiles fetched over the session | 42 | 46 |

Scrub cost is the criterion: v2 reaches v1's zero-network scrubbing without
v1's layer-per-frame stack. The 4 extra tiles are the overlap between warming
and the two visible layers racing for the same keys.

### PR 4 — pruning, legend, flag default (landed)

- **`RADAR_MAX_LEVEL` 9 → 7.** Everything above 7 was a placeholder.
- **Clouds/Combined pruned.** The modes, the mode selector, `makeCloudProvider`,
  `recolorCloudTile`, `getCloudLut` and v1's combined-mode layer code are gone.
  Worth noting they were not merely redundant: with zero infrared frames,
  `buildTimeline` returned an empty array in satellite mode, so picking Clouds
  blanked the radar and hid the timeline. Controls are now window + palette +
  opacity + play, as the plan specified.
- **Upstream nowcast dropped as a source.** `nowcastFrames` and the hatched
  forecast zone stay — that is where Stage C's advection frames land.
- **The radar legend** is registered in `layerLegends`, which puts it on the
  operator app's floating legend stack and under the crisis share globe
  automatically. Built from the same LUT the tiles are painted with (so it
  cannot drift) and composites the palette's per-pixel alpha over the panel
  ground, so the swatches read the way they do over the globe. Per the
  registry's store-free rule it shows the default Storm ramp.
- **`radarEngine` now defaults to v2.** `?radar=v1` remains the kill switch for
  one release.

**Store shape changed** — `mode`, `setMode` and `satelliteFrames` are gone, and
`setManifest` lost its fourth argument. `buildTimeline`/`nowIndex` keep working
for `EarthTimeBar`, which passes the whole store state and relies on structural
typing; `buildTimeline`'s parameter type was narrowed to the three fields it
actually reads so that stays true as fields come and go.

One consequence of the observation-based prefetch worth knowing: warmed
coordinates age out after 90 s, so a camera left untouched eventually plans
nothing (Cesium has no reason to re-request tiles it already holds). The
prefetcher deliberately does not report readiness in that state — reporting 0
would undo a loop that is fully warm — and drops to a 2 s heartbeat.
