async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Request to ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Request to ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Authed JSON request (cookie-JWT). Surfaces the server's error message so the
// watchlist form can show "socrata needs config.domain and config.dataset" etc.
async function authJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `Request to ${path} failed: ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
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
    getJson<{
      flights: import('../types').FlightState[];
      trackedTails: string[];
      events: import('../types').FlightEvent[];
    }>('/api/flights/registrations'),
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
  newsMap: (query?: string, timespan?: string) => {
    const qs = new URLSearchParams();
    if (query) qs.set('query', query);
    if (timespan) qs.set('timespan', timespan);
    const s = qs.toString();
    return getJson<import('../types').NewsMapResponse>(`/api/news-map${s ? `?${s}` : ''}`);
  },
  smoke: () => getJson<import('../types').SmokeResponse>('/api/smoke'),
  aqi: () => getJson<import('../types').AqiResponse>('/api/aqi'),
  wind: () => getJson<import('../types').WindGrid>('/api/wind'),
  lightningHistory: (minutes: number, near?: { lat: number; lon: number; radiusMi: number }) =>
    getJson<import('../types').LightningHistoryResponse>(
      `/api/lightning?minutes=${minutes}` +
        (near ? `&lat=${near.lat.toFixed(3)}&lon=${near.lon.toFixed(3)}&radiusMi=${near.radiusMi}` : '')
    ),
  rivers: () => getJson<import('../types').RiversResponse>('/api/rivers'),
  fireOutlook: () => getJson<import('../types').FireOutlookResponse>('/api/fire-outlook'),
  jtwcInvests: () => getJson<import('../types').JtwcInvestsResponse>('/api/jtwc-invests'),
  outages: () => getJson<import('../types').OutagesResponse>('/api/outages'),
  briefing: (signals: unknown) =>
    postJson<import('../types').BriefingResponse>('/api/briefing', { signals }),
  riverDetail: (lid: string) =>
    getJson<import('../types').RiverDetail>(`/api/rivers/${encodeURIComponent(lid)}`),
  windForecast: (lat: number, lon: number) =>
    getJson<import('../types').WindForecast>(`/api/wind/forecast?lat=${lat}&lon=${lon}`),
  weatherDaily: (lat: number, lon: number) =>
    getJson<import('../types').DailyForecast>(`/api/wind/daily?lat=${lat}&lon=${lon}`),

  // OSINT intel engine: the public read-only feed + the team-shared watchlist CRUD.
  intel: () => getJson<import('../types').IntelResponse>('/api/intel'),
  watchlist: () => authJson<import('../types').WatchlistSource[]>('/api/watchlist', 'GET'),
  addWatchSource: (body: {
    kind: string;
    label: string;
    url?: string | null;
    config?: Record<string, unknown>;
  }) => authJson<import('../types').WatchlistSource>('/api/watchlist', 'POST', body),
  setWatchSourceActive: (id: string, active: boolean) =>
    authJson<import('../types').WatchlistSource>(`/api/watchlist/${id}`, 'PATCH', { active }),
  deleteWatchSource: (id: string) =>
    authJson<{ ok: boolean }>(`/api/watchlist/${id}`, 'DELETE'),
};
