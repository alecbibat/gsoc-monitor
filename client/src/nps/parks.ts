// The parks followed through the NPS Data API — mirrors server/src/nps/parks.ts
// (the server decides what is fetched; this adds what the map needs).

export interface NpsParkMeta {
  code: string;
  name: string;
  fullName: string;
  /** [west, south, east, north] of the park boundary (NPS Land Resources Division). */
  bbox: [number, number, number, number];
}

export const NPS_PARKS: readonly NpsParkMeta[] = [
  { code: 'glac', name: 'Glacier', fullName: 'Glacier National Park', bbox: [-114.475, 48.234, -113.242, 49.001] },
  { code: 'yell', name: 'Yellowstone', fullName: 'Yellowstone National Park', bbox: [-111.156, 44.132, -109.824, 45.109] },
  { code: 'grca', name: 'Grand Canyon', fullName: 'Grand Canyon National Park', bbox: [-113.98, 35.75, -111.587, 36.866] },
  { code: 'deva', name: 'Death Valley', fullName: 'Death Valley National Park', bbox: [-118.001, 35.591, -116.277, 37.349] },
  { code: 'romo', name: 'Rocky Mountain', fullName: 'Rocky Mountain National Park', bbox: [-105.914, 40.158, -105.494, 40.554] },
  { code: 'moru', name: 'Mount Rushmore', fullName: 'Mount Rushmore National Memorial', bbox: [-103.469, 43.868, -103.429, 43.892] },
];

export const NPS_PARK_BY_CODE: ReadonlyMap<string, NpsParkMeta> = new Map(NPS_PARKS.map((p) => [p.code, p]));
