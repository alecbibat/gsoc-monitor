import { Router } from 'express';
import { cache } from '../cache';
import { config } from '../config';

const router = Router();

// Pizzerias within delivery range of the Pentagon. BestTime resolves a venue by
// name + address, so these should be real, geocodable addresses. Adjust freely —
// any venue BestTime can't resolve simply falls back to the modeled signal in
// the widget (live = null), it won't break the others.
interface Venue {
  name: string;
  area: string;
  address: string;
}
const VENUES: Venue[] = [
  { name: 'We, The Pizza', area: 'Crystal City', address: '2100 Crystal Dr, Arlington, VA 22202' },
  { name: '&pizza', area: 'Pentagon Row', address: '1101 S Joyce St, Arlington, VA 22202' },
  { name: "Domino's Pizza", area: 'Pentagon City', address: '1410 S Fern St, Arlington, VA 22202' },
  { name: 'Extreme Pizza', area: 'Pentagon Row', address: '1419 S Fern St, Arlington, VA 22202' },
  { name: "Papa John's Pizza", area: 'Pentagon City', address: '1304 S Fern St, Arlington, VA 22202' },
];

interface PlaceBusyness {
  name: string;
  area: string;
  live: number | null; // current busyness 0-100, null when unavailable
  forecast: number | null; // typical busyness for this hour 0-100
  delta: number | null; // live minus forecast (positive = busier than usual)
}

interface BestTimeLiveResponse {
  analysis?: {
    venue_forecasted_busyness?: number;
    venue_live_busyness?: number;
    venue_live_busyness_available?: boolean;
    venue_live_forecasted_delta?: number;
  };
  status?: string;
}

async function fetchLive(venue: Venue): Promise<PlaceBusyness> {
  const fallback: PlaceBusyness = {
    name: venue.name,
    area: venue.area,
    live: null,
    forecast: null,
    delta: null,
  };
  try {
    const url = new URL('https://besttime.app/api/v1/forecasts/live');
    url.searchParams.set('api_key_private', config.besttimeApiKey);
    url.searchParams.set('venue_name', venue.name);
    url.searchParams.set('venue_address', venue.address);

    const r = await fetch(url, { method: 'POST' });
    if (!r.ok) return fallback;
    const j = (await r.json()) as BestTimeLiveResponse;
    const a = j.analysis;
    if (!a) return fallback;

    const available = a.venue_live_busyness_available === true;
    return {
      name: venue.name,
      area: venue.area,
      live: available && typeof a.venue_live_busyness === 'number' ? a.venue_live_busyness : null,
      forecast: typeof a.venue_forecasted_busyness === 'number' ? a.venue_forecasted_busyness : null,
      delta:
        available && typeof a.venue_live_forecasted_delta === 'number'
          ? a.venue_live_forecasted_delta
          : null,
    };
  } catch {
    return fallback;
  }
}

router.get('/', async (_req, res) => {
  if (!config.besttimeApiKey) {
    // No key configured — tell the client to use its modeled signal.
    res.json({ source: 'no-key', places: [], updated: Date.now() });
    return;
  }

  try {
    // BestTime credits are limited, so cache aggressively: live busyness only
    // moves on a ~10-15 min cadence and this is shared across all viewers.
    const data = await cache.getOrFetch('pizza:besttime', 15 * 60_000, async () => {
      const places = await Promise.all(VENUES.map(fetchLive));
      return { source: 'besttime' as const, places, updated: Date.now() };
    });
    res.json(data);
  } catch (err) {
    res.status(200).json({ source: 'error', places: [], updated: Date.now(), detail: String(err) });
  }
});

export default router;
