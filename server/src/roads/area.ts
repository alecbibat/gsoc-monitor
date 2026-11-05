// The parts of the map the road-closures layer covers: each followed park's
// boundary extent plus a margin wide enough for the highways that are the
// way in (Williams–Flagstaff for the Grand Canyon, Gardiner and Cody for
// Yellowstone, Estes Park for Rocky Mountain, Rapid City for Rushmore),
// narrow enough that a statewide DOT feed doesn't flood it with city traffic.

export interface ParkArea {
  parkCode: string;
  /** [west, south, east, north]: the park's extent plus its margin. */
  bbox: [number, number, number, number];
}

// Park extents from the NPS Land Resources Division boundary service; margins
// in degrees, chosen per park for its gateway towns.
const PARK_EXTENTS: Array<{ parkCode: string; extent: [number, number, number, number]; margin: number }> = [
  { parkCode: 'glac', extent: [-114.475, 48.234, -113.242, 49.001], margin: 0.4 },
  { parkCode: 'yell', extent: [-111.156, 44.132, -109.824, 45.109], margin: 0.55 },
  { parkCode: 'grca', extent: [-113.98, 35.75, -111.587, 36.866], margin: 0.6 },
  { parkCode: 'deva', extent: [-118.001, 35.591, -116.277, 37.349], margin: 0.3 },
  { parkCode: 'romo', extent: [-105.914, 40.158, -105.494, 40.554], margin: 0.3 },
  { parkCode: 'moru', extent: [-103.469, 43.868, -103.429, 43.892], margin: 0.4 },
];

export const PARK_AREAS: readonly ParkArea[] = PARK_EXTENTS.map(({ parkCode, extent: [w, s, e, n], margin }) => ({
  parkCode,
  bbox: [w - margin, s - margin, e + margin, n + margin],
}));

const inBox = ([lon, lat]: number[], [w, s, e, n]: [number, number, number, number]) =>
  lon >= w && lon <= e && lat >= s && lat <= n;

/** The park area a closure's geometry touches (the first one any vertex falls in), or null. */
export function parkAreaFor(lines: number[][][], point: [number, number] | null): string | null {
  for (const area of PARK_AREAS) {
    if (point && inBox(point, area.bbox)) return area.parkCode;
    for (const line of lines) if (line.some((p) => inBox(p, area.bbox))) return area.parkCode;
  }
  return null;
}

/** The middle vertex of the longest line (by vertex count), for a marker. */
export function midpointOf(lines: number[][][]): [number, number] | null {
  let best: number[][] | null = null;
  for (const line of lines) if (!best || line.length > best.length) best = line;
  if (!best || best.length === 0) return null;
  const p = best[Math.floor(best.length / 2)];
  return [p[0], p[1]];
}
