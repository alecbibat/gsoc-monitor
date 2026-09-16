import * as Cesium from 'cesium';
import { useEffect } from 'react';
import { feature as topoFeature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { useScreensaverStore } from '../../screensaver/screensaverStore';
import { useHoverStore } from '../../screensaver/hoverStore';
import { useTimeZonesStatus } from './timezonesStore';
import { attachPanelData } from '../../cesium/entityPanelLink';
import { captionFor, readZone, resolveZoneClock, type ZoneClock, type ZoneReading } from './zoneClock';
import { buildZoneShape, placeLabel, type ZoneShape } from './zoneLabelPlacement';

// Real time-zone polygons — one per set of places whose clocks agree from
// today onward, oceans included — from the timezone-boundary-builder project
// (OpenStreetMap data, ODbL). scripts/build-timezones.mjs downloads a release,
// simplifies it to ~1 km and writes this TopoJSON; timezones.meta.json
// records which release. Served with the app, so no third-party CDN.
const DATA_URL = '/data/timezones.topo.json';

interface ZoneProps {
  tzid: string;
}
type ZoneTopology = Topology<{ zones: GeometryCollection<ZoneProps> }>;

// Cesium's rhumb-line tessellation computes isometric latitude
// log(tan(π/4 + φ/2)), which diverges to ∞/NaN at |lat| = 90° and crashes
// polygon geometry creation ("Invalid array length"). The Antarctic zones
// run to the pole, so clamp every coordinate just inside the valid range.
const MAX_ABS_LAT = 89.99;
function clampLon(v: number): number {
  return v < -180 ? -180 : v > 180 ? 180 : v;
}
function clampLat(v: number): number {
  return v < -MAX_ABS_LAT ? -MAX_ABS_LAT : v > MAX_ABS_LAT ? MAX_ABS_LAT : v;
}
type Ring = number[][];
function clampRing(ring: Ring): void {
  for (const c of ring) {
    if (c.length >= 2) {
      c[0] = clampLon(c[0]);
      c[1] = clampLat(c[1]);
    }
  }
}
function sanitizeGeometry(geom: GeoJSON.Geometry | null): void {
  if (!geom) return;
  if (geom.type === 'Polygon') {
    (geom.coordinates as Ring[]).forEach(clampRing);
  } else if (geom.type === 'MultiPolygon') {
    (geom.coordinates as Ring[][]).forEach((poly) => poly.forEach(clampRing));
  }
}

// Maps UTC offset (−12 … +14) to a hue on the color wheel: blue in the west,
// cycling through cyan → green → yellow → orange → red in the east. Keyed to
// the offset in force right now, so a zone on summer time takes the hue of
// the offset it is actually keeping (and changes hue when DST ends).
function zoneColor(utcHours: number, alpha: number): Cesium.Color {
  const t = Math.max(0, Math.min(1, (utcHours + 12) / 26)); // 0=UTC-12, 1=UTC+14
  const hDeg = (1 - t) * 240; // 240° (blue) → 0° (red), no wrap-around
  const s = 0.72;
  const l = 0.50;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hDeg / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hDeg < 60)       { r = c; g = x; b = 0; }
  else if (hDeg < 120) { r = x; g = c; b = 0; }
  else if (hDeg < 180) { r = 0; g = c; b = x; }
  else                 { r = 0; g = x; b = c; }
  return new Cesium.Color(r + m, g + m, b + m, alpha);
}
const UNKNOWN_FILL = new Cesium.Color(0.4, 0.4, 0.4, 0.10);
const UNKNOWN_OUTLINE = Cesium.Color.WHITE.withAlpha(0.18);

// ── Live clock labels ────────────────────────────────────────────────────────
//
// Every zone polygon carries a clock label that ticks once a second: a
// monospace HH:MM:SS with a small caption underneath giving the offset and
// daylight-saving name in force ("UTC-4 · EDT", or "UTC+14 · +1d" when that
// zone is already on a different day from the viewer). Every point of a
// polygon shares those, so the caption is exact for the whole shape.
// Labels are Cesium primitives (a LabelCollection, not entities): a text
// change rebinds that label's glyph billboards and the collection rewrites
// its vertex buffers once per tick (~1k billboards, a millisecond or two),
// then one scene frame is requested — the same 1 fps the satellite layer
// costs while it is on. Labels on the far side of the globe are skipped.
//
// Zones are big — America/New_York's polygon runs from the Gulf coast to the
// Arctic, Africa/Abidjan's takes in the whole UTC ocean strip — so instead of
// one fixed anchor the label slides along its shape to stay near the camera
// (see zoneLabelPlacement.ts). Labels are re-anchored only when the camera
// settles, so during a drag or a screensaver fly-to they behave like map
// features rather than hopping HUD chrome.

// index.html loads JetBrains Mono at 400/500/600 only, so ask for the weight
// that exists rather than let a 700 request silently match down to it.
const TIME_FONT = '600 15px "JetBrains Mono", ui-monospace, Menlo, monospace';
const CAPTION_FONT = '600 10px Inter, system-ui, sans-serif';
// Opaque fills (brightness in RGB, alpha 1) keep the glyph cores in Cesium's
// opaque pass with a depth write; a translucent fill would be sorted against
// the 22%-alpha zone polygons by bounding-sphere distance and could tint or
// pop as the labels slide.
const TIME_FILL = new Cesium.Color(0.96, 0.96, 0.96, 1);
const CAPTION_FILL = new Cesium.Color(0.78, 0.78, 0.78, 1);
const OUTLINE = Cesium.Color.BLACK.withAlpha(0.85);
// Barely shrink with distance: the zoomed-out globe is the wall-display view.
const LABEL_SCALE = new Cesium.NearFarScalar(2.0e6, 1.0, 2.5e7, 0.9);
// A zone only gets a label while it spans roughly 60px or more on screen
// (span × 20 ≈ the camera height at which that happens for a 1400px canvas),
// so Lord Howe Island and Norfolk Island don't stack a clock on top of their
// neighbours' at continental zoom. Never below 250 km so a small zone is
// still labelled when you are looking straight at it.
const MIN_LABEL_FAR_M = 250_000;
const LABEL_FAR_PER_SPAN = 20;
// The label row sits a little above the view centre so a zoomed-in clock
// doesn't cover the very spot you are looking at, and a neighbouring zone's
// label may slide to within 12% of the visible width of its near edge.
const LAT_BIAS_FRACTION = 0.22;
const MAX_LAT_BIAS_DEG = 5;
const LON_MARGIN_FRACTION = 0.12;
// A zone the camera can't reach — an Antarctic-only shape when you are
// looking at the mid-latitudes — keeps its clock hidden until the view centre
// comes within this many degrees of its latitude range.
const HIDE_BEYOND_LAT_GAP_DEG = 20;
// Screensaver / hover close-ups drop every basemap label (CesiumGlobe's
// PINS_FADE band) so the cinematic shots carry no text; the clocks follow the
// same rule below this camera height while one of those modes is running.
const CLOSEUP_HIDE_HEIGHT_M = 1_500_000;
// The rendered globe is a coarse mesh, so a label a few degrees past the
// ideal ellipsoid's horizon can still peek out at the limb; keep ticking
// those rather than leave a stale clock on screen.
const HORIZON_SLACK = Math.sin(Cesium.Math.toRadians(8));
// Waiting on the web font before rasterising glyphs: Cesium caches each glyph
// bitmap per font string, so a label drawn before JetBrains Mono arrives
// would keep the fallback face forever. Bounded so a blocked font host can't
// hold the layer hostage.
const FONT_WAIT_MS = 1500;

interface LabelRecord {
  shape: ZoneShape;
  clock: ZoneClock;
  time: Cesium.Label;
  caption: Cesium.Label;
  lon: number;
  lat: number;
  position: Cesium.Cartesian3;
  /** Geodetic surface normal at `position`, for the horizon test. */
  normal: Cesium.Cartesian3;
}

// Per-zone state that changes only at a DST transition (or an offset reform
// the browser's tz database already knows about): the fill hue, the entity
// name and the panel title all follow the offset in force.
interface ZoneState {
  clock: ZoneClock;
  entities: Cesium.Entity[];
  offsetMin: number;
}

async function waitForFonts(): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  try {
    await Promise.race([
      Promise.all([fonts.load(TIME_FONT), fonts.load(CAPTION_FONT)]),
      new Promise<void>((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
    ]);
  } catch {
    // Font loading is best-effort; the fallback face still reads fine.
  }
}

function featureIndexOf(entity: Cesium.Entity): number | null {
  // GeoJsonDataSource keeps feature.id as the entity id (a MultiPolygon's
  // extra parts get "_2", "_3" … suffixes), which is how a zone finds all
  // of its entities.
  const m = /^tz-(\d+)/.exec(entity.id);
  return m ? parseInt(m[1], 10) : null;
}

function stylePolygon(entity: Cesium.Entity, fill: Cesium.Color, outline: Cesium.Color): void {
  if (!entity.polygon) return;
  entity.polygon.material = new Cesium.ColorMaterialProperty(fill) as unknown as Cesium.MaterialProperty;
  entity.polygon.outlineColor = new Cesium.ConstantProperty(outline);
  entity.polygon.outline = new Cesium.ConstantProperty(true);
  entity.polygon.outlineWidth = new Cesium.ConstantProperty(1);
  entity.polygon.height = new Cesium.ConstantProperty(0);
}

// Everything about a zone that depends on the offset in force.
function applyZoneStyle(state: ZoneState, reading: ZoneReading): void {
  const hours = reading.offsetMin / 60;
  const title = reading.abbr ? `${reading.offsetLabel} · ${reading.abbr}` : reading.offsetLabel;
  for (const entity of state.entities) {
    stylePolygon(entity, zoneColor(hours, 0.22), zoneColor(hours, 0.55));
    entity.name = title;
    attachPanelData(entity, {
      id: `timezone-${state.clock.key}`,
      kind: 'timezones',
      title,
      subtitle: state.clock.iana,
      payload: { tzid: state.clock.iana },
    });
  }
  state.offsetMin = reading.offsetMin;
}

export function TimeZonesLayer() {
  const viewer = useCesiumViewer();
  const active = useLayersStore((s) => s.active.timezones);

  useEffect(() => {
    const setStatus = useTimeZonesStatus.getState().setStatus;
    if (!viewer || !active) {
      setStatus({ loading: false, ready: false, count: 0, error: null });
      return;
    }

    const scene = viewer.scene;
    const ellipsoid = scene.globe.ellipsoid;
    const camera = viewer.camera;
    let mounted = true;
    const abort = new AbortController();
    let ds: Cesium.GeoJsonDataSource | null = null;
    let labels: Cesium.LabelCollection | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const disposers: Array<() => void> = [];
    const records: LabelRecord[] = [];
    const zones = new Map<string, ZoneState>();

    setStatus({ loading: true, error: null });

    // ── Per-second tick ────────────────────────────────────────────────────
    const readings = new Map<string, ZoneReading>();
    const scratchRect = new Cesium.Rectangle();
    const scratchToCamera = new Cesium.Cartesian3();

    // A surface point is in front of the globe's horizon exactly when the
    // camera lies on the outer side of the tangent plane there — allow a
    // little past that (see HORIZON_SLACK).
    const facesCamera = (rec: LabelRecord): boolean => {
      Cesium.Cartesian3.subtract(camera.positionWC, rec.position, scratchToCamera);
      const dot = Cesium.Cartesian3.dot(rec.normal, scratchToCamera);
      return dot > -HORIZON_SLACK * Cesium.Cartesian3.magnitude(scratchToCamera);
    };

    // Read every zone once (66 Intl calls, well under a millisecond), restyle
    // any whose offset just changed, then refresh label text — on the regular
    // tick only for labels the camera can see (the rest catch up the moment
    // they come round, because a camera settle always runs the full pass).
    const updateTexts = (everything: boolean) => {
      const now = Date.now();
      readings.clear();
      let restyled = false;
      for (const state of zones.values()) {
        const r = readZone(state.clock, now);
        readings.set(state.clock.key, r);
        if (r.offsetMin !== state.offsetMin) {
          applyZoneStyle(state, r);
          restyled = true;
        }
      }
      for (const rec of records) {
        if (!everything && !facesCamera(rec)) continue;
        const r = readings.get(rec.clock.key);
        if (!r) continue;
        // Label.text is a no-op when unchanged, so the caption costs nothing
        // outside the once-a-day/DST-transition moments it actually changes.
        rec.time.text = r.hhmmss;
        rec.caption.text = captionFor(r);
      }
      return restyled;
    };

    // Whole-collection visibility: off during screensaver / hover close-ups,
    // matching the basemap labels.
    const syncVisibility = () => {
      if (!labels) return;
      const ss = useScreensaverStore.getState();
      const hv = useHoverStore.getState();
      const closeUp = (ss.active || hv.active) &&
        (camera.positionCartographic?.height ?? Infinity) < CLOSEUP_HIDE_HEIGHT_M;
      const show = !closeUp;
      if (labels.show !== show) {
        labels.show = show;
        scene.requestRender();
      }
    };

    // Self-rescheduling so every tick lands just after the wall-clock second
    // boundary (a plain setInterval drifts and lands mid-second).
    const tick = () => {
      timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
      if (document.hidden || records.length === 0) return;
      syncVisibility();
      updateTexts(false);
      scene.requestRender();
    };
    const onVisible = () => {
      if (!document.hidden && records.length) {
        updateTexts(true);
        scene.requestRender();
      }
    };

    // ── Camera-following placement (on every camera settle) ────────────────
    const scratchCenter = new Cesium.Cartesian2();
    const scratchCarto = new Cesium.Cartographic();

    const viewCenter = (): { lon: number; lat: number } | null => {
      const canvas = scene.canvas;
      scratchCenter.x = canvas.clientWidth / 2;
      scratchCenter.y = canvas.clientHeight / 2;
      const hit = camera.pickEllipsoid(scratchCenter, ellipsoid);
      // Looking past the limb: fall back to the point under the camera.
      const carto = hit
        ? Cesium.Cartographic.fromCartesian(hit, ellipsoid, scratchCarto)
        : camera.positionCartographic;
      if (!carto) return null;
      return { lon: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) };
    };

    const place = () => {
      if (records.length === 0) return;
      const c = viewCenter();
      if (!c) return;
      const rect = camera.computeViewRectangle(ellipsoid, scratchRect);
      // Rectangle.MAX_VALUE comes back when the globe doesn't fill the view;
      // treat that as the whole hemisphere.
      const heightDeg = rect ? Math.min(180, Cesium.Math.toDegrees(rect.height)) : 180;
      const widthDeg = rect ? Math.min(360, Cesium.Math.toDegrees(rect.width)) : 360;

      const targetLat = c.lat + Math.min(MAX_LAT_BIAS_DEG, heightDeg * LAT_BIAS_FRACTION);
      const lonMargin = widthDeg * LON_MARGIN_FRACTION;
      let changed = false;
      for (const rec of records) {
        const latGap = Math.max(rec.shape.minLat - c.lat, c.lat - rec.shape.maxLat, 0);
        const visible = latGap <= HIDE_BEYOND_LAT_GAP_DEG;
        if (rec.time.show !== visible) {
          rec.time.show = visible;
          rec.caption.show = visible;
          changed = true;
        }
        if (!visible) continue;
        const p = placeLabel(rec.shape, c.lon, targetLat, { lonMargin });
        if (p.lon === rec.lon && p.lat === rec.lat) continue;
        rec.lon = p.lon;
        rec.lat = p.lat;
        Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0, ellipsoid, rec.position);
        ellipsoid.geodeticSurfaceNormal(rec.position, rec.normal);
        rec.time.position = rec.position;
        rec.caption.position = rec.position;
        changed = true;
      }
      syncVisibility();
      updateTexts(true);
      if (changed) scene.requestRender();
    };

    // ── Load ───────────────────────────────────────────────────────────────
    (async () => {
      try {
        const resp = await fetch(DATA_URL, { signal: abort.signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const topo = (await resp.json()) as ZoneTopology;
        // topojson-client rebuilds each zone's rings from the shared arcs, so
        // neighbouring zones can never gap or overlap along a border.
        const gj = topoFeature(topo, topo.objects.zones) as GeoJSON.FeatureCollection<
          GeoJSON.Polygon | GeoJSON.MultiPolygon,
          ZoneProps
        >;
        gj.features.forEach((f, i) => {
          sanitizeGeometry(f.geometry);
          f.id = `tz-${i}`;
        });
        if (!mounted) return;

        const [loaded] = await Promise.all([
          Cesium.GeoJsonDataSource.load(gj, {
            stroke: Cesium.Color.WHITE.withAlpha(0.20),
            strokeWidth: 0.8,
            fill: Cesium.Color.TRANSPARENT, // overridden per entity below
            clampToGround: false,
          }),
          waitForFonts(),
        ]);
        if (!mounted) return;
        ds = loaded;

        // Group the entities Cesium made (one per polygon part) by zone.
        const entitiesByFeature = new Map<number, Cesium.Entity[]>();
        for (const entity of ds.entities.values) {
          if (!entity.polygon) continue;
          const idx = featureIndexOf(entity);
          if (idx === null) continue;
          const list = entitiesByFeature.get(idx);
          if (list) list.push(entity);
          else entitiesByFeature.set(idx, [entity]);
        }

        labels = new Cesium.LabelCollection();
        const now = Date.now();
        let unknown = 0;

        gj.features.forEach((f, i) => {
          const entities = entitiesByFeature.get(i);
          if (!entities?.length) return;
          const clock = resolveZoneClock(f.properties.tzid);
          if (!clock) {
            // A zone this browser's tz database doesn't know: draw it, but
            // without a clock we would only be guessing at.
            unknown++;
            for (const entity of entities) stylePolygon(entity, UNKNOWN_FILL, UNKNOWN_OUTLINE);
            return;
          }

          const state: ZoneState = { clock, entities, offsetMin: NaN };
          const reading = readZone(clock, now);
          applyZoneStyle(state, reading);
          zones.set(clock.key, state);

          const shape = buildZoneShape(f.geometry);
          if (!shape || !labels) return;
          const far = Math.max(MIN_LABEL_FAR_M, shape.spanMeters * LABEL_FAR_PER_SPAN);
          const anchor = shape.polygons[0].interior;
          const position = Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat, 0, ellipsoid);
          // Clicking the clock opens the same panel as clicking the zone.
          const pickId = entities[0];
          const time = labels.add({
            id: pickId,
            position,
            text: reading.hhmmss,
            font: TIME_FONT,
            fillColor: TIME_FILL,
            outlineColor: OUTLINE,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -1),
            scaleByDistance: LABEL_SCALE,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, far),
          });
          const caption = labels.add({
            id: pickId,
            position,
            text: captionFor(reading),
            font: CAPTION_FONT,
            fillColor: CAPTION_FILL,
            outlineColor: OUTLINE,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(0, 1),
            scaleByDistance: LABEL_SCALE,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, far),
          });
          records.push({
            shape,
            clock,
            time,
            caption,
            lon: anchor.lon,
            lat: anchor.lat,
            position,
            normal: ellipsoid.geodeticSurfaceNormal(position, new Cesium.Cartesian3()),
          });
        });

        viewer.dataSources.add(ds);
        scene.primitives.add(labels);

        place();
        disposers.push(camera.moveEnd.addEventListener(place));
        disposers.push(useScreensaverStore.subscribe(syncVisibility));
        disposers.push(useHoverStore.subscribe(syncVisibility));
        document.addEventListener('visibilitychange', onVisible);
        disposers.push(() => document.removeEventListener('visibilitychange', onVisible));
        tick();

        setStatus({
          loading: false,
          ready: true,
          count: zones.size,
          error: unknown ? `${unknown} zone${unknown === 1 ? '' : 's'} unknown to this browser` : null,
        });
        scene.requestRender();
      } catch (err: unknown) {
        if (!mounted || abort.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setStatus({ loading: false, error: `Timezones: ${msg}` });
      }
    })();

    return () => {
      mounted = false;
      abort.abort();
      if (timer) clearTimeout(timer);
      for (const off of disposers) off();
      records.length = 0;
      zones.clear();
      // After a WebGL context loss CesiumGlobe destroys the viewer before the
      // layers unmount; a destroyed viewer's collections throw on touch.
      if (!viewer.isDestroyed()) {
        // remove() destroys the collection and its GPU resources.
        if (labels && !labels.isDestroyed()) scene.primitives.remove(labels);
        if (ds) viewer.dataSources.remove(ds, true);
        scene.requestRender();
      }
      labels = null;
      ds = null;
      setStatus({ loading: false, ready: false, count: 0, error: null });
    };
  }, [viewer, active]);

  return null;
}
