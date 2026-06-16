async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Request to ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  earthquakes: (magnitude: string, period: string) =>
    getJson<GeoJSON.FeatureCollection>(
      `/api/earthquakes?magnitude=${magnitude}&period=${period}`
    ),
  alerts: (area?: string) =>
    getJson<GeoJSON.FeatureCollection>(`/api/alerts${area ? `?area=${area}` : ''}`),
  radarManifest: () => getJson<import('../types').RadarManifest>('/api/radar'),
  flights: (bbox: { lamin: number; lomin: number; lamax: number; lomax: number }) =>
    getJson<{ states: unknown[][] | null }>(
      `/api/flights?lamin=${bbox.lamin}&lomin=${bbox.lomin}&lamax=${bbox.lamax}&lomax=${bbox.lomax}`
    ),
  geocode: (q: string) =>
    getJson<Array<{ lat: string; lon: string; display_name: string; boundingbox: string[] }>>(
      `/api/geocode?q=${encodeURIComponent(q)}`
    ),
};
