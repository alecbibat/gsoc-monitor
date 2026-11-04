import * as Cesium from 'cesium';
import { useScreensaverStore } from '../screensaver/screensaverStore';
import { useHoverStore } from '../screensaver/hoverStore';
import {
  CollisionGrid,
  MAX_ZOOM,
  displayText,
  equivalentZoom,
  parsePlaceRows,
  priorityOf,
  tierOf,
  type Box,
  type LabelTier,
  type PlaceRow,
} from './placeLabelModel';

// ── Vector place labels ─────────────────────────────────────────────────────
//
// Country, state/province, city and water names drawn as screen-space Cesium
// labels instead of the basemap's raster label tiles. Raster text draped on a
// 3D globe misbehaves in ways a flat web map never shows: it stretches and
// skews as the view tilts or nears the limb, grows and shrinks in steps as
// imagery levels swap in, goes soft between levels, is cut off at tile seams
// where neighbouring tiles come from different levels, and turns with the
// map. These labels instead stay upright, the same pixel size at every zoom,
// and sharp (Cesium renders label glyphs as signed-distance fields).
//
// Which names show is decided in screen space, Mapbox-style: every place
// whose curated zoom threshold (Natural Earth min_zoom) the view has passed,
// in front of the horizon and on screen, is tried in priority order, and a
// label only lands where it doesn't touch one already placed. Placement reruns
// a few times a second while the camera moves; labels fade in and out rather
// than pop, so the map reads as one continuous surface.

export type LabelTheme = 'dark' | 'light' | 'imagery';

export interface PlaceLabelsHandle {
  // null hides every label (map types whose tiles carry their own names).
  setTheme(theme: LabelTheme | null): void;
  destroy(): void;
}

const DATA_URL = '/data/place-labels.json';

const FAMILY = 'Inter, system-ui, sans-serif';
// Sized for wall displays read from across a room as much as for desks.
const TIER_FONT: Record<LabelTier, { css: string; px: number }> = {
  country: { css: `600 13px ${FAMILY}`, px: 13 },
  state: { css: `600 11px ${FAMILY}`, px: 11 },
  water: { css: `italic 500 12px ${FAMILY}`, px: 12 },
  city1: { css: `600 14.5px ${FAMILY}`, px: 14.5 },
  city2: { css: `500 13px ${FAMILY}`, px: 13 },
  city3: { css: `500 12px ${FAMILY}`, px: 12 },
};
// Cities get a dot at their true position with the name set beside it, so a
// name never hides what's at the spot it names. Areas (countries, states,
// water) are centred on their label point with no dot.
const DOT_PX: Partial<Record<LabelTier, number>> = { city1: 5, city2: 4.5, city3: 3.5 };
const DOT_GAP_PX = 4;

interface ThemePaint {
  halo: Cesium.Color;
  haloWidth: number;
  dotOutline: Cesium.Color;
  fill: Record<LabelTier, Cesium.Color>;
}
const css = (s: string) => Cesium.Color.fromCssColorString(s);
const THEMES: Record<LabelTheme, ThemePaint> = {
  // Dark gray canvas: soft whites in three steps of emphasis, areas recede.
  dark: {
    halo: css('rgba(13,15,19,0.9)'),
    haloWidth: 3,
    dotOutline: css('rgba(13,15,19,0.9)'),
    fill: {
      country: css('#d6dbe3'),
      state: css('#98a1ae'),
      water: css('#7d9bbf'),
      city1: css('#f5f7fa'),
      city2: css('#e1e5eb'),
      city3: css('#c2c8d1'),
    },
  },
  // Light gray canvas: inked text on a white halo.
  light: {
    halo: css('rgba(255,255,255,0.92)'),
    haloWidth: 3,
    dotOutline: css('rgba(255,255,255,0.95)'),
    fill: {
      country: css('#3f4651'),
      state: css('#7a828f'),
      water: css('#5b80ab'),
      city1: css('#1d2229'),
      city2: css('#30363e'),
      city3: css('#4d545e'),
    },
  },
  // Photographic imagery is busy at every scale, so a heavier halo.
  imagery: {
    halo: css('rgba(0,0,0,0.8)'),
    haloWidth: 3.5,
    dotOutline: css('rgba(0,0,0,0.85)'),
    fill: {
      country: css('#ffffff'),
      state: css('#e4e8ee'),
      water: css('#b3cfee'),
      city1: css('#ffffff'),
      city2: css('#f2f4f7'),
      city3: css('#dfe3e9'),
    },
  },
};

// Shift on Natural Earth's thresholds: the globe's perspective view packs more
// ground into the frame than a flat web map does at the same centre scale, and
// collision culling keeps density in check, so names may come in a little early.
const ZOOM_BIAS = -0.3;
// Sine of the view's elevation above a place's horizon: names fade out between
// these as they near the globe's limb, where the land compresses.
const LIMB_HIDE = 0.06;
const LIMB_FULL = 0.2;
// Nearer the limb than this, a city's name goes on the side facing the
// globe's centre first, so it lies over land rather than hanging into space.
const LIMB_INWARD = 0.35;
const MAX_LABELS = 240;
const PLACE_INTERVAL_MS = 120; // re-place at most this often while moving
const FADE_MS = 240;
const PAD_X = 3; // breathing room around each label's box
const PAD_Y = 1.5;
const EDGE_PX = 2; // labels must sit wholly on screen

// Cinematic orbits (pins screensaver, hover mode) clear names off close-ups
// while keeping them on the zoomed-out overview — same rule the time-zone
// clocks follow.
const CINEMATIC_FADE = { near: 500_000, far: 1_500_000 };

const FONT_WAIT_MS = 2500;

let rowsPromise: Promise<PlaceRow[]> | null = null;
function loadRows(): Promise<PlaceRow[]> {
  if (!rowsPromise) {
    rowsPromise = fetch(DATA_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`place labels: HTTP ${r.status}`);
        return r.json() as Promise<unknown>;
      })
      .then(parsePlaceRows)
      .catch((err: unknown) => {
        rowsPromise = null; // let a later viewer retry
        throw err;
      });
  }
  return rowsPromise;
}

// Cesium rasterises (and caches) each glyph per font string, so a label made
// before Inter arrives would keep the fallback face forever.
async function waitForFonts(): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  try {
    await Promise.race([
      Promise.all(Object.values(TIER_FONT).map((f) => fonts.load(f.css))),
      new Promise<void>((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
    ]);
  } catch {
    // Best-effort: the fallback face still reads fine.
  }
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measureText(text: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

// Place names are context, not targets: keep them out of the pick pass so a
// click on a name over a ship or an alert still opens that feature.
function skipPickPass(primitive: unknown): void {
  const p = primitive as { update: (frameState: { passes?: { pick?: boolean } }) => void };
  const update = p.update.bind(p);
  p.update = (frameState) => {
    if (frameState?.passes?.pick) return;
    update(frameState);
  };
}

const SIDE_CENTER = 0;
const SIDE_RIGHT = 1;
const SIDE_LEFT = -1;
type Side = typeof SIDE_CENTER | typeof SIDE_RIGHT | typeof SIDE_LEFT;

interface Live {
  label: Cesium.Label;
  dot: Cesium.PointPrimitive | null;
  side: Side;
  opacity: number;
  target: number;
}

interface Place {
  row: PlaceRow;
  tier: LabelTier;
  text: string;
  priority: number;
  maxZoom: number;
  cosLat: number;
  position: Cesium.Cartesian3;
  normal: Cesium.Cartesian3;
  dotPx: number;
  w: number; // text width in CSS px, measured on first use
  h: number;
  seen: number; // placement pass that last accepted it
  live: Live | null;
}

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

export function createPlaceLabels(viewer: Cesium.Viewer): PlaceLabelsHandle {
  const scene = viewer.scene;
  const camera = viewer.camera;
  const ellipsoid = scene.globe.ellipsoid;

  const dots = new Cesium.PointPrimitiveCollection();
  const labels = new Cesium.LabelCollection({ scene });
  skipPickPass(dots);
  skipPickPass(labels);
  scene.primitives.add(dots);
  scene.primitives.add(labels);

  let destroyed = false;
  let theme: LabelTheme | null = null;
  // Palette labels are painted with — the last real theme, so names still
  // fade out in their own colours after the theme is switched off.
  let paintTheme: LabelTheme | null = null;
  let places: Place[] = [];
  const live = new Set<Place>();
  const grid = new CollisionGrid(64);
  let pass = 0;
  let lastPlace = -Infinity;
  let needsPlace = true;
  let placeTimer: ReturnType<typeof setTimeout> | null = null;
  const lastView = new Cesium.Matrix4();
  let haveView = false;
  let lastW = 0;
  let lastH = 0;
  let lastFrame = performance.now();

  const scratchToCam = new Cesium.Cartesian3();
  const scratchWin = new Cesium.Cartesian2();
  const scratchCentre = new Cesium.Cartesian2();
  const scratchFill = new Cesium.Color();
  const scratchHalo = new Cesium.Color();

  const kick = () => {
    needsPlace = true;
    if (!destroyed && !viewer.isDestroyed()) scene.requestRender();
  };

  const cinematicAlpha = (): number => {
    const ss = useScreensaverStore.getState();
    const cinematic = (ss.active && ss.mode === 'pins') || useHoverStore.getState().active;
    if (!cinematic) return 1;
    const h = camera.positionCartographic?.height ?? Number.POSITIVE_INFINITY;
    return clamp01((h - CINEMATIC_FADE.near) / (CINEMATIC_FADE.far - CINEMATIC_FADE.near));
  };

  // Screen box a label would take on `side` of its anchor at (x, y).
  const boxFor = (p: Place, x: number, y: number, side: Side): Box => {
    const halfH = p.h / 2 + PAD_Y;
    if (side === SIDE_CENTER) {
      const halfW = p.w / 2 + PAD_X;
      return { x0: x - halfW, x1: x + halfW, y0: y - halfH, y1: y + halfH };
    }
    const r = p.dotPx / 2 + 1;
    const reach = r + DOT_GAP_PX + p.w + PAD_X;
    return side === SIDE_RIGHT
      ? { x0: x - r - PAD_X, x1: x + reach, y0: y - halfH, y1: y + halfH }
      : { x0: x - reach, x1: x + r + PAD_X, y0: y - halfH, y1: y + halfH };
  };

  const onScreen = (b: Box, W: number, H: number) =>
    b.x0 >= EDGE_PX && b.y0 >= EDGE_PX && b.x1 <= W - EDGE_PX && b.y1 <= H - EDGE_PX;

  // First side (if any) the label fits on. A live city label keeps the side
  // it already has so names don't flip about as the view moves; otherwise
  // names go right of the dot, or toward the globe's centre near the limb.
  const fit = (p: Place, x: number, y: number, W: number, H: number, inward: Side): Side | null => {
    const first: Side = p.live && p.live.side !== SIDE_CENTER ? p.live.side : inward;
    const sides: Side[] =
      p.dotPx === 0 ? [SIDE_CENTER] : first === SIDE_LEFT ? [SIDE_LEFT, SIDE_RIGHT] : [SIDE_RIGHT, SIDE_LEFT];
    for (const side of sides) {
      const b = boxFor(p, x, y, side);
      if (onScreen(b, W, H) && grid.fits(b)) {
        grid.insert(b);
        return side;
      }
    }
    return null;
  };

  const paint = (p: Place) => {
    const l = p.live;
    if (!l || !paintTheme) return;
    const t = THEMES[paintTheme];
    const base = t.fill[p.tier];
    Cesium.Color.clone(base, scratchFill);
    scratchFill.alpha = base.alpha * l.opacity;
    Cesium.Color.clone(t.halo, scratchHalo);
    scratchHalo.alpha = t.halo.alpha * l.opacity;
    l.label.fillColor = scratchFill;
    l.label.outlineColor = scratchHalo;
    if (l.dot) {
      l.dot.color = scratchFill;
      Cesium.Color.clone(t.dotOutline, scratchHalo);
      scratchHalo.alpha = t.dotOutline.alpha * l.opacity;
      l.dot.outlineColor = scratchHalo;
    }
  };

  const applySide = (l: Live, p: Place, side: Side) => {
    l.side = side;
    const offset = p.dotPx / 2 + DOT_GAP_PX;
    l.label.horizontalOrigin =
      side === SIDE_RIGHT
        ? Cesium.HorizontalOrigin.LEFT
        : side === SIDE_LEFT
          ? Cesium.HorizontalOrigin.RIGHT
          : Cesium.HorizontalOrigin.CENTER;
    l.label.pixelOffset = new Cesium.Cartesian2(side * offset, 0);
  };

  const show = (p: Place, side: Side, target: number) => {
    p.seen = pass;
    if (!p.live && theme) {
      const t = THEMES[theme];
      const label = labels.add({
        position: p.position,
        text: p.text,
        font: TIER_FONT[p.tier].css,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        fillColor: Cesium.Color.TRANSPARENT,
        outlineColor: Cesium.Color.TRANSPARENT,
        outlineWidth: t.haloWidth,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        // Our own horizon test decides visibility; never let terrain or 3D
        // buildings bite into the text.
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
      const dot = p.dotPx
        ? dots.add({
            position: p.position,
            pixelSize: p.dotPx,
            color: Cesium.Color.TRANSPARENT,
            outlineColor: Cesium.Color.TRANSPARENT,
            outlineWidth: 1.25,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          })
        : null;
      p.live = { label, dot, side, opacity: 0, target: 0 };
      applySide(p.live, p, side);
      live.add(p);
    } else if (p.live && p.live.side !== side) {
      applySide(p.live, p, side);
    }
    if (p.live) p.live.target = target;
  };

  const retire = (p: Place) => {
    const l = p.live;
    if (!l) return;
    labels.remove(l.label);
    if (l.dot) dots.remove(l.dot);
    p.live = null;
    live.delete(p);
  };

  const place = () => {
    pass++;
    grid.clear();
    const canvas = scene.canvas;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    lastW = W;
    lastH = H;
    const band = theme ? cinematicAlpha() : 0;
    const frustum = camera.frustum as Cesium.PerspectiveFrustum;
    if (band > 0.001 && places.length && W > 0 && H > 0 && frustum.fovy) {
      // Ground metres per screen pixel, per metre of distance from the camera.
      const mppPerMetre = (2 * Math.tan(frustum.fovy / 2)) / H;
      const camPos = camera.positionWC;
      // Where the globe's centre falls on screen, to point limb names inward.
      const centre = Cesium.SceneTransforms.worldToWindowCoordinates(scene, Cesium.Cartesian3.ZERO, scratchCentre);
      const centreX = centre ? centre.x : W / 2;
      let count = 0;
      for (const p of places) {
        Cesium.Cartesian3.subtract(camPos, p.position, scratchToCam);
        const dist = Cesium.Cartesian3.magnitude(scratchToCam);
        if (dist <= 0) continue;
        const sinElev = Cesium.Cartesian3.dot(p.normal, scratchToCam) / dist;
        if (sinElev < LIMB_HIDE) continue; // behind or skimming the horizon
        const z = equivalentZoom(dist * mppPerMetre, p.cosLat);
        const past = z - (p.row.minZoom + ZOOM_BIAS);
        if (past < 0 || z > p.maxZoom) continue;
        const win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, p.position, scratchWin);
        if (!win) continue;
        if (p.w < 0) {
          p.w = measureText(p.text, TIER_FONT[p.tier].css);
          p.h = TIER_FONT[p.tier].px * 1.2;
        }
        const inward: Side = sinElev < LIMB_INWARD && win.x > centreX ? SIDE_LEFT : SIDE_RIGHT;
        const side = fit(p, win.x, win.y, W, H, inward);
        if (side === null) continue;
        const limb = clamp01((sinElev - LIMB_HIDE) / (LIMB_FULL - LIMB_HIDE));
        // Fully opaque once placed (the time-based fade brings it in): a name
        // left half-faded by its zoom threshold reads as a ghost, not a label.
        show(p, side, band * limb);
        if (++count >= MAX_LABELS) break;
      }
    }
    for (const p of live) if (p.seen !== pass && p.live) p.live.target = 0;
    lastPlace = performance.now();
  };

  // Ease every live label toward its target opacity; true while any still moves.
  const fade = (now: number): boolean => {
    const dt = Math.min(100, Math.max(0, now - lastFrame));
    lastFrame = now;
    let moving = false;
    for (const p of live) {
      const l = p.live;
      if (!l) continue;
      if (l.opacity !== l.target) {
        const step = dt / FADE_MS;
        l.opacity =
          l.opacity < l.target ? Math.min(l.target, l.opacity + step) : Math.max(l.target, l.opacity - step);
        paint(p);
        if (l.opacity !== l.target) moving = true;
      }
      if (l.opacity <= 0 && l.target <= 0) retire(p);
    }
    return moving;
  };

  const onPreRender = () => {
    if (destroyed) return;
    const now = performance.now();
    const view = camera.viewMatrix;
    if (!haveView || !Cesium.Matrix4.equals(view, lastView)) {
      Cesium.Matrix4.clone(view, lastView);
      haveView = true;
      needsPlace = true;
    }
    if (scene.canvas.clientWidth !== lastW || scene.canvas.clientHeight !== lastH) needsPlace = true;
    if (needsPlace) {
      const wait = PLACE_INTERVAL_MS - (now - lastPlace);
      if (wait <= 0) {
        needsPlace = false;
        place();
      } else if (!placeTimer) {
        // The camera may stop before the next slot; make sure a frame comes
        // round to do the final placement for where it came to rest.
        placeTimer = setTimeout(() => {
          placeTimer = null;
          if (!destroyed && !viewer.isDestroyed()) scene.requestRender();
        }, wait + 5);
      }
    }
    if (fade(now)) scene.requestRender();
  };
  const offPreRender = scene.preRender.addEventListener(onPreRender);
  const offScreensaver = useScreensaverStore.subscribe(kick);
  const offHover = useHoverStore.subscribe(kick);

  Promise.all([loadRows(), waitForFonts()])
    .then(([rows]) => {
      if (destroyed || viewer.isDestroyed()) return;
      places = rows.map((row) => {
        const tier = tierOf(row);
        const position = Cesium.Cartesian3.fromDegrees(row.lon, row.lat, 0, ellipsoid);
        return {
          row,
          tier,
          text: displayText(row, tier),
          priority: priorityOf(row),
          maxZoom: MAX_ZOOM[row.kind],
          cosLat: Math.cos(Cesium.Math.toRadians(row.lat)),
          position,
          normal: ellipsoid.geodeticSurfaceNormal(position, new Cesium.Cartesian3()),
          dotPx: DOT_PX[tier] ?? 0,
          w: -1,
          h: 0,
          seen: 0,
          live: null,
        };
      });
      // Stable on ties, so the dataset's own order (bigger first) breaks them.
      places.sort((a, b) => a.priority - b.priority);
      kick();
    })
    .catch((err: unknown) => {
      console.warn('[place labels] could not load place names', err);
    });

  return {
    setTheme(next) {
      if (next === theme) return;
      const prev = theme;
      theme = next;
      if (next) {
        paintTheme = next;
        // Restyle in place; labels keep their current fade.
        for (const p of live) {
          if (p.live) p.live.label.outlineWidth = THEMES[next].haloWidth;
          paint(p);
        }
      } else if (prev) {
        for (const p of live) if (p.live) p.live.target = 0;
      }
      kick();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offPreRender();
      offScreensaver();
      offHover();
      if (placeTimer) clearTimeout(placeTimer);
      live.clear();
      if (!viewer.isDestroyed()) {
        scene.primitives.remove(labels);
        scene.primitives.remove(dots);
        scene.requestRender();
      }
    },
  };
}
