// The parks the dashboard follows through the NPS Data API: news releases on
// the ticker, alerts in the popups, road events on the road-closures layer.
// One list, so the three can't drift apart. Mirrored client-side in
// client/src/nps/parks.ts (names and map extents).

export interface NpsPark {
  /** NPS unit code, as the API takes it (lowercase). */
  code: string;
  /** Short display name. */
  name: string;
  fullName: string;
  /** A representative point (the main visitor area), for anchoring items on the map. */
  lat: number;
  lon: number;
}

export const NPS_PARKS: readonly NpsPark[] = [
  { code: 'glac', name: 'Glacier', fullName: 'Glacier National Park', lat: 48.694, lon: -113.718 },
  { code: 'yell', name: 'Yellowstone', fullName: 'Yellowstone National Park', lat: 44.428, lon: -110.588 },
  { code: 'grca', name: 'Grand Canyon', fullName: 'Grand Canyon National Park', lat: 36.056, lon: -112.139 },
  { code: 'deva', name: 'Death Valley', fullName: 'Death Valley National Park', lat: 36.457, lon: -116.866 },
  { code: 'romo', name: 'Rocky Mountain', fullName: 'Rocky Mountain National Park', lat: 40.343, lon: -105.683 },
  { code: 'moru', name: 'Mount Rushmore', fullName: 'Mount Rushmore National Memorial', lat: 43.879, lon: -103.459 },
];

export const NPS_PARK_BY_CODE: ReadonlyMap<string, NpsPark> = new Map(NPS_PARKS.map((p) => [p.code, p]));

/** The parkCode query value covering every followed park. */
export const NPS_PARK_CODES = NPS_PARKS.map((p) => p.code).join(',');
