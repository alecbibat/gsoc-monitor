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
  flightsByTail: () =>
    getJson<{ flights: import('../types').FlightState[]; trackedTails: string[] }>(
      '/api/flights/registrations'
    ),
  geocode: (q: string) =>
    getJson<Array<{ lat: string; lon: string; display_name: string; boundingbox: string[] }>>(
      `/api/geocode?q=${encodeURIComponent(q)}`
    ),
  ships: () => getJson<import('../types').ShipsResponse>('/api/ships'),
  satellites: (group: import('../types').SatelliteGroup) =>
    getJson<import('../types').SatellitesResponse>(`/api/satellites?group=${group}`),
  news: (extras?: Array<{ url: string; label: string }>) => {
    if (extras && extras.length > 0) {
      const param = encodeURIComponent(JSON.stringify(extras));
      return getJson<import('../types').NewsResponse>(`/api/news?extra=${param}`);
    }
    return getJson<import('../types').NewsResponse>('/api/news');
  },
  county: (fips: string) => getJson<GeoJSON.FeatureCollection>(`/api/county/${fips}`),
  park: (code: string) => getJson<GeoJSON.FeatureCollection>(`/api/park/${code}`),
  directions: (lat: number, lon: number) =>
    getJson<import('../types').DirectionsResponse>(`/api/directions?lat=${lat}&lon=${lon}`),
  drive: (fromLat: number, fromLon: number, toLat: number, toLon: number) =>
    getJson<import('../types').DriveResult>(
      `/api/drive?fromLat=${fromLat}&fromLon=${fromLon}&toLat=${toLat}&toLon=${toLon}`
    ),
  parkNews: () => getJson<import('../types').NewsResponse>('/api/park-news'),
  webcams: () => getJson<import('../types').WebcamsResponse>('/api/webcams'),
};
