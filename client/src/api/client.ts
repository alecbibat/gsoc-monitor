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
  radarManifest: () => getJson<import('../types').RadarManifest>('/api/radar'),
  flights: (lat: number, lon: number, dist: number) =>
    getJson<{ flights: import('../types').FlightState[] }>(
      `/api/flights?lat=${lat}&lon=${lon}&dist=${dist}`
    ),
  geocode: (q: string) =>
    getJson<Array<{ lat: string; lon: string; display_name: string; boundingbox: string[] }>>(
      `/api/geocode?q=${encodeURIComponent(q)}`
    ),
  pizza: () => getJson<import('../types').PizzaBusyness>('/api/pizza'),
  ships: () => getJson<import('../types').ShipsResponse>('/api/ships'),
  news: () => getJson<import('../types').NewsResponse>('/api/news'),
  county: (fips: string) => getJson<GeoJSON.FeatureCollection>(`/api/county/${fips}`),
};
