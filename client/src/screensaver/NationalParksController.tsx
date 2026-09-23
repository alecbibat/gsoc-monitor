import * as Cesium from 'cesium';
import { useEffect, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore, type Poi } from './screensaverStore';
import { api } from '../api/client';

const OVERVIEW_ALT = 5_000_000; // continental US view
const OVERVIEW_LAT = 38;
const OVERVIEW_LON = -96;

const POI_INTERVAL_MIN_MS = 12_000;
const POI_INTERVAL_MAX_MS = 20_000;
const POI_DWELL_MIN_MS = 12_000;
const POI_DWELL_MAX_MS = 18_000;

// Boundary glow: ring colour and its 0..1 pulse (drives width + alpha).
const RING_COLOR = Cesium.Color.fromCssColorString('#7cffb0');
const pulsePhase = (startMs: number) =>
  0.5 + 0.5 * Math.sin(((Date.now() - startMs) / 1000) * Math.PI * 1.4);

interface ParkPoi {
  title: string;
  unitCode?: string; // NPS park unit code → park boundary outline (e.g. GRCA)
  fips?: string; // county FIPS → county outline, for non-park office locations
  lat: number;
  lon: number;
  altitudeM: number;
  facts: string[];
}

const PARKS: ParkPoi[] = [
  {
    title: 'Grand Canyon National Park',
    unitCode: 'GRCA',
    lat: 36.1069,
    lon: -112.1129,
    altitudeM: 500_000,
    facts: [
      'The Grand Canyon is 277 miles long, up to 18 miles wide, and over a mile deep — carved by the Colorado River over 5–6 million years.',
      'The canyon exposes nearly 2 billion years of Earth\'s geological history across 40 distinct rock layers.',
      'Inner gorge temperatures exceed 110°F in summer while the North Rim at 8,000 ft may see snow in June.',
      'Over 5 million visitors arrive annually, but 90% never descend below the rim.',
      'The Havasupai Tribe has lived at the canyon bottom for at least 800 years — accessible only by foot, horse, or helicopter.',
    ],
  },
  {
    title: 'Glacier National Park',
    unitCode: 'GLAC',
    lat: 48.6960,
    lon: -113.7180,
    altitudeM: 400_000,
    facts: [
      'Glacier National Park contains 700+ miles of trails, 762 lakes, and more than 200 waterfalls across 1 million acres.',
      'The park had 150 glaciers in 1850; fewer than 25 remain — scientists project they could all vanish by 2030.',
      'Going-to-the-Sun Road, completed in 1932, is one of the most scenic mountain roads in North America at 50 miles long.',
      'The park straddles the Continental Divide and drains into three oceans: the Pacific, Atlantic, and Hudson Bay.',
      'Glacier is home to all 7 of Montana\'s large mammal species — grizzly, wolf, wolverine, lynx, and more.',
    ],
  },
  {
    title: 'Mount Rushmore National Memorial',
    unitCode: 'MORU',
    lat: 43.8791,
    lon: -103.4591,
    altitudeM: 60_000,
    facts: [
      'The four faces — Washington, Jefferson, Roosevelt, and Lincoln — each measure 60 feet tall.',
      'Sculptor Gutzon Borglum used dynamite for 90% of the 450,000 tons of rock removed during 14 years of carving (1927–1941).',
      'Each president represents a century: Washington (founding), Jefferson (expansion), Lincoln (preservation), Roosevelt (development).',
      'Behind Lincoln\'s hairline a Hall of Records chamber was carved — unfinished, but now holds a titanium vault of national documents.',
      'The Black Hills site was originally sacred Lakota territory named the Six Grandfathers, or Tunkasila Sakpe Paha.',
    ],
  },
  {
    title: 'Yellowstone National Park',
    unitCode: 'YELL',
    lat: 44.4280,
    lon: -110.5885,
    altitudeM: 600_000,
    facts: [
      'Yellowstone sits atop a supervolcano that last erupted 640,000 years ago — 1,000× more powerful than Mt. St. Helens.',
      'The park contains more than half of the world\'s active geysers — over 500 — including Old Faithful.',
      'Yellowstone was the world\'s first national park, established by President Grant on March 1, 1872.',
      'The Yellowstone River is the longest undammed river in the contiguous United States at 692 miles.',
      'Hydrothermal features release 40,000–60,000 lbs of sulfur dioxide per day — more than some industrial sources.',
    ],
  },
  {
    title: 'Windstar Office · Miami',
    fips: '12086',
    lat: 25.7617,
    lon: -80.1918,
    altitudeM: 120_000,
    facts: [
      'Miami-Dade is the most populous county in Florida with nearly 2.7 million residents.',
      'PortMiami is the world\'s busiest cruise ship port, handling over 6 million passengers annually.',
      'Miami-Dade is the only US metro bordered by two national parks: Everglades and Biscayne.',
      'The county is one of the few places in North America where alligators and crocodiles coexist naturally.',
      'Miami was co-founded by Julia Tuttle — one of the very few major US cities founded by a woman.',
    ],
  },
  {
    title: 'Death Valley National Park',
    unitCode: 'DEVA',
    lat: 36.5054,
    lon: -117.0794,
    altitudeM: 400_000,
    facts: [
      'Death Valley holds the world record for highest reliably recorded air temperature: 134°F (56.7°C) on July 10, 1913.',
      'Badwater Basin, at 282 feet below sea level, is the lowest point in North America.',
      'Death Valley receives less than 2 inches of rain per year — yet wildflower superblooms occur after rare heavy rains.',
      'The Racetrack Playa\'s "sailing stones" — rocks up to 700 lbs — move on their own across the dry lake bed.',
      'Despite its name, Death Valley supports 1,000+ plant species and 440 animal species, including the endangered Devil\'s Hole pupfish.',
    ],
  },
  {
    title: 'Xanterra Office · Aurora, CO',
    fips: '08005',
    lat: 39.6508,
    lon: -104.7750,
    altitudeM: 120_000,
    facts: [
      'Arapahoe County was one of the 17 original counties created when the Colorado Territory was established in 1861.',
      'The county is named after the Arapaho people, who inhabited the eastern Rocky Mountain foothills for centuries.',
      'Arapahoe County\'s Cherry Creek State Park hosts the only designated swimming beach in the Denver metropolitan area.',
      'Centennial, the county seat, is the largest US city specifically planned and built as a county seat.',
      'Xanterra, headquartered here, operates lodges in 10 national parks including Yellowstone, Grand Canyon, and Zion.',
    ],
  },
];

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

// Pick a fact index for a park that wasn't the last one shown.
function nextFactIndex(parkIndex: number, lastIndexes: number[]): number {
  const park = PARKS[parkIndex];
  const last = lastIndexes[parkIndex];
  const options = park.facts
    .map((_, i) => i)
    .filter((i) => i !== last);
  return options[Math.floor(Math.random() * options.length)];
}

export function NationalParksController() {
  const viewer = useCesiumViewer();
  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const setPhase = useScreensaverStore((s) => s.setPhase);
  const setCurrentPoi = useScreensaverStore((s) => s.setCurrentPoi);

  const cancelledRef = useRef(false);
  const phaseRef = useRef<'rotating' | 'flying-to' | 'at-poi' | 'flying-back'>('rotating');
  const parkQueueRef = useRef<number[]>([]); // indices into PARKS, shuffled
  const poiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-park last fact index to avoid repeating the same fact.
  const lastFactIndexRef = useRef<number[]>(PARKS.map(() => -1));
  // Active boundary DataSource reference for cleanup.
  const boundarySourceRef = useRef<Cesium.GeoJsonDataSource | null>(null);
  // Pulsing ring outlines (one GroundPolylinePrimitive) + their preRender pulse.
  const ringPrimitiveRef = useRef<Cesium.GroundPolylinePrimitive | null>(null);
  const ringPulseOffRef = useRef<(() => void) | null>(null);
  // Monotonic park-visit token: boundary fetches that land after their visit
  // ended are dropped instead of leaking into viewer.dataSources.
  const visitSeqRef = useRef(0);

  function updatePhase(p: typeof phaseRef.current) {
    phaseRef.current = p;
    setPhase(p);
  }

  function shuffledParkQueue(): number[] {
    const arr = PARKS.map((_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Fetch and render the boundary outline for a park (NPS unit) or office
  // (county). Cesium clamps WebGL line width to 1px, so we draw each polygon
  // ring as a glowing polyline to get a clearly visible, thick outline.
  async function loadBoundaryHighlight(v: Cesium.Viewer, park: ParkPoi, visit: number) {
    try {
      const geoJson = park.unitCode
        ? await api.park(park.unitCode)
        : park.fips
          ? await api.county(park.fips)
          : null;
      // Bail if the tour moved on while the boundary was downloading — a late
      // response would otherwise add an orphaned data source that nothing ever
      // removes (its per-frame pulse callbacks then run for the session).
      if (!geoJson || cancelledRef.current || visitSeqRef.current !== visit) return;

      const source = await Cesium.GeoJsonDataSource.load(geoJson, {
        fill: Cesium.Color.fromCssColorString('#4ade80').withAlpha(0.1),
        stroke: Cesium.Color.fromCssColorString('#4ade80').withAlpha(0.9),
        strokeWidth: 2,
        clampToGround: true,
      });
      if (cancelledRef.current || visitSeqRef.current !== visit) return;

      const now = Cesium.JulianDate.now();
      // Pulsing width + alpha for an animated glowing border.
      const startMs = Date.now();
      const p0 = pulsePhase(startMs);
      // A ground polyline's width and colour are per-instance batch-table
      // attributes, so all rings go into one primitive that is pulsed in place.
      // As entities with a CallbackProperty width, Cesium would rebuild every
      // ring's (survey-detailed) geometry and GPU buffers on every frame.
      // Without ground-polyline support the entity path already degrades to a
      // cheap in-place line, so keep entity rings there.
      const entityPulse = Cesium.GroundPolylinePrimitive.isSupported(v.scene)
        ? null
        : {
            width: new Cesium.CallbackProperty(() => 3 + 2.5 * pulsePhase(startMs), false),
            material: new Cesium.ColorMaterialProperty(
              new Cesium.CallbackProperty(
                () => RING_COLOR.withAlpha(0.35 + 0.65 * pulsePhase(startMs)),
                false
              )
            ),
          };
      const ringIds: string[] = [];
      const instances: Cesium.GeometryInstance[] = [];
      // Snapshot existing polygon entities, then add a border for each ring.
      for (const entity of source.entities.values.slice()) {
        const poly = entity.polygon;
        if (!poly) continue;
        const hierarchy = poly.hierarchy?.getValue(now) as Cesium.PolygonHierarchy | undefined;
        if (!hierarchy) continue;
        const rings = [hierarchy.positions, ...(hierarchy.holes ?? []).map((h) => h.positions)];
        for (const positions of rings) {
          if (!positions || positions.length < 2) continue;
          if (entityPulse) {
            source.entities.add({
              polyline: {
                positions: [...positions, positions[0]],
                ...entityPulse,
                clampToGround: true,
              },
            });
            continue;
          }
          const id = `park-ring-${visit}-${ringIds.length}`;
          ringIds.push(id);
          instances.push(new Cesium.GeometryInstance({
            id,
            geometry: new Cesium.GroundPolylineGeometry({
              positions: [...positions, positions[0]],
              width: 3 + 2.5 * p0,
            }),
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                RING_COLOR.withAlpha(0.35 + 0.65 * p0)
              ),
            },
          }));
        }
        poly.outline = new Cesium.ConstantProperty(false);
      }

      removeBoundaryHighlight(v); // reclaim any predecessor before replacing the refs
      boundarySourceRef.current = source;
      const added = v.dataSources.add(source);
      if (instances.length > 0) {
        // scene.groundPrimitives already holds DataSourceDisplay's ground
        // collection, so the rings still draw after (over) the fill.
        const prim = v.scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
          geometryInstances: instances,
          appearance: new Cesium.PolylineColorAppearance(),
        })) as Cesium.GroundPolylinePrimitive;
        ringPrimitiveRef.current = prim;
        // The attribute setters copy into the batch table, so reuse the buffers.
        const widthVal = [0];
        const colorScratch = new Cesium.Color();
        const colorVal = new Uint8Array(4);
        ringPulseOffRef.current = v.scene.preRender.addEventListener(() => {
          // Instance attributes only exist once the worker-built primitive is ready.
          if (!prim.ready) return;
          const p = pulsePhase(startMs);
          widthVal[0] = 3 + 2.5 * p;
          Cesium.ColorGeometryInstanceAttribute.toValue(
            RING_COLOR.withAlpha(0.35 + 0.65 * p, colorScratch),
            colorVal
          );
          for (const id of ringIds) {
            const attrs = prim.getGeometryInstanceAttributes(id);
            if (!attrs) continue;
            attrs.width = widthVal;
            attrs.color = colorVal;
          }
        });
      }
      await added;
    } catch {
      // Boundary highlight is non-critical — silently skip on any failure.
    }
  }

  function removeBoundaryHighlight(v: Cesium.Viewer) {
    ringPulseOffRef.current?.();
    ringPulseOffRef.current = null;
    if (ringPrimitiveRef.current) {
      v.scene.groundPrimitives.remove(ringPrimitiveRef.current); // scene collections destroy on remove
      ringPrimitiveRef.current = null;
    }
    if (boundarySourceRef.current) {
      v.dataSources.remove(boundarySourceRef.current, true);
      boundarySourceRef.current = null;
    }
  }

  const isParks = active && mode === 'national-parks';

  useEffect(() => {
    if (!isParks || !viewer) return;
    const v = viewer;

    cancelledRef.current = false;
    parkQueueRef.current = shuffledParkQueue();
    lastFactIndexRef.current = PARKS.map(() => -1);

    const prevRequestRender = v.scene.requestRenderMode;
    const prevMaxRenderTime = v.scene.maximumRenderTimeChange;
    v.scene.requestRenderMode = false;

    // Fly to continental US overview first.
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(OVERVIEW_LON, OVERVIEW_LAT, OVERVIEW_ALT),
      duration: 2.5,
      complete: () => {
        if (cancelledRef.current) return;
        v.scene.requestRenderMode = prevRequestRender; // parked: render on demand
        v.scene.requestRender();
      },
    });

    function scheduleNextPark() {
      if (cancelledRef.current) return;
      poiTimerRef.current = setTimeout(visitNextPark, rand(POI_INTERVAL_MIN_MS, POI_INTERVAL_MAX_MS));
    }

    function visitNextPark() {
      if (cancelledRef.current) return;
      // The boundary pulse only advances on rendered frames, so render
      // continuously from here until the fly-back lands.
      v.scene.requestRenderMode = false;
      // Refill queue when exhausted.
      if (parkQueueRef.current.length === 0) {
        parkQueueRef.current = shuffledParkQueue();
      }
      const parkIndex = parkQueueRef.current.shift()!;
      const park = PARKS[parkIndex];
      const factIndex = nextFactIndex(parkIndex, lastFactIndexRef.current);
      lastFactIndexRef.current[parkIndex] = factIndex;

      const poi: Poi = {
        title: park.title,
        description: park.facts[factIndex],
        lat: park.lat,
        lon: park.lon,
        altitudeM: park.altitudeM,
        category: 'park',
      };

      updatePhase('flying-to');
      setCurrentPoi(poi);

      v.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(park.lon, park.lat, park.altitudeM),
        duration: 5.0,
        complete: () => {
          if (cancelledRef.current) return;
          updatePhase('at-poi');
          // Outline the park (or office county) boundary.
          loadBoundaryHighlight(v, park, visitSeqRef.current);
          dwellTimerRef.current = setTimeout(leaveParkAndReturn, rand(POI_DWELL_MIN_MS, POI_DWELL_MAX_MS));
        },
      });
    }

    function leaveParkAndReturn() {
      if (cancelledRef.current) return;
      updatePhase('flying-back');
      setCurrentPoi(null);

      // Remove boundary highlight while flying back; invalidate any fetch
      // still in flight for the visit we're leaving.
      visitSeqRef.current++;
      removeBoundaryHighlight(v);

      v.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(OVERVIEW_LON, OVERVIEW_LAT, OVERVIEW_ALT),
        duration: 4.5,
        complete: () => {
          if (cancelledRef.current) return;
          // Parked on the overview until the next visit: render on demand.
          v.scene.requestRenderMode = prevRequestRender;
          v.scene.requestRender();
          updatePhase('rotating');
          scheduleNextPark();
        },
      });
    }

    // Start first park visit shortly after fly-to-overview.
    poiTimerRef.current = setTimeout(scheduleNextPark, 2800);

    return () => {
      cancelledRef.current = true;
      // Invalidate any boundary fetch still pending: a quick restart resets
      // cancelledRef, so only the visit token keeps it out of the new session.
      visitSeqRef.current++;
      if (poiTimerRef.current) clearTimeout(poiTimerRef.current);
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
      removeBoundaryHighlight(v);

      v.scene.requestRenderMode = prevRequestRender;
      v.scene.maximumRenderTimeChange = prevMaxRenderTime;
      updatePhase('rotating');
      setCurrentPoi(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isParks, viewer]);

  return null;
}
