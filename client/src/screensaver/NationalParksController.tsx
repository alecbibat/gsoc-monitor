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

interface ParkPoi {
  title: string;
  fips: string;
  lat: number;
  lon: number;
  altitudeM: number;
  facts: string[];
}

const PARKS: ParkPoi[] = [
  {
    title: 'Grand Canyon National Park',
    fips: '04005',
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
    fips: '30029',
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
    fips: '46103',
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
    fips: '56029',
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
    fips: '06027',
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
  // Active county DataSource reference for cleanup.
  const countySourceRef = useRef<Cesium.GeoJsonDataSource | null>(null);

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

  async function loadCountyHighlight(v: Cesium.Viewer, fips: string) {
    try {
      const geoJson = await api.county(fips);
      if (cancelledRef.current) return;
      const source = await Cesium.GeoJsonDataSource.load(geoJson, {
        fill: Cesium.Color.fromCssColorString('#4ade80').withAlpha(0.18),
        stroke: Cesium.Color.fromCssColorString('#4ade80').withAlpha(0.85),
        strokeWidth: 3,
        clampToGround: true,
      });
      if (cancelledRef.current) { return; }
      countySourceRef.current = source;
      await v.dataSources.add(source);
    } catch {
      // County highlight is non-critical — silently skip.
    }
  }

  function removeCountyHighlight(v: Cesium.Viewer) {
    if (countySourceRef.current) {
      v.dataSources.remove(countySourceRef.current, true);
      countySourceRef.current = null;
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
    });

    function scheduleNextPark() {
      if (cancelledRef.current) return;
      poiTimerRef.current = setTimeout(visitNextPark, rand(POI_INTERVAL_MIN_MS, POI_INTERVAL_MAX_MS));
    }

    function visitNextPark() {
      if (cancelledRef.current) return;
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
          // Load county polygon highlight.
          loadCountyHighlight(v, park.fips);
          dwellTimerRef.current = setTimeout(leaveParkAndReturn, rand(POI_DWELL_MIN_MS, POI_DWELL_MAX_MS));
        },
      });
    }

    function leaveParkAndReturn() {
      if (cancelledRef.current) return;
      updatePhase('flying-back');
      setCurrentPoi(null);

      // Remove county highlight while flying back.
      removeCountyHighlight(v);

      v.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(OVERVIEW_LON, OVERVIEW_LAT, OVERVIEW_ALT),
        duration: 4.5,
        complete: () => {
          if (cancelledRef.current) return;
          updatePhase('rotating');
          scheduleNextPark();
        },
      });
    }

    // Start first park visit shortly after fly-to-overview.
    poiTimerRef.current = setTimeout(scheduleNextPark, 2800);

    return () => {
      cancelledRef.current = true;
      if (poiTimerRef.current) clearTimeout(poiTimerRef.current);
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
      removeCountyHighlight(v);

      v.scene.requestRenderMode = prevRequestRender;
      v.scene.maximumRenderTimeChange = prevMaxRenderTime;
      updatePhase('rotating');
      setCurrentPoi(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isParks, viewer]);

  return null;
}
