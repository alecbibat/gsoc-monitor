import { Router } from 'express';
import { cache } from '../cache';
import { config } from '../config';

const router = Router();

async function getAuthHeader(): Promise<Record<string, string>> {
  const { clientId, clientSecret } = config.openSky;
  if (!clientId || !clientSecret) return {};

  const token = await cache.getOrFetch('opensky:token', 25 * 60_000, async () => {
    const resp = await fetch(
      'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      }
    );
    if (!resp.ok) throw new Error(`OpenSky auth error: ${resp.status}`);
    const json = (await resp.json()) as { access_token: string };
    return json.access_token;
  });

  return { Authorization: `Bearer ${token}` };
}

function isValidLat(n: number) {
  return Number.isFinite(n) && n >= -90 && n <= 90;
}
function isValidLon(n: number) {
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

router.get('/', async (req, res) => {
  const lamin = Number(req.query.lamin);
  const lomin = Number(req.query.lomin);
  const lamax = Number(req.query.lamax);
  const lomax = Number(req.query.lomax);

  if (![lamin, lamax].every(isValidLat) || ![lomin, lomax].every(isValidLon)) {
    res.status(400).json({ error: 'lamin/lomin/lamax/lomax must be valid coordinates' });
    return;
  }

  // Round bbox to reduce cache cardinality so nearby viewports share results.
  const round = (n: number) => Math.round(n * 4) / 4;
  const cacheKey = `flights:${round(lamin)}:${round(lomin)}:${round(lamax)}:${round(lomax)}`;

  try {
    const data = await cache.getOrFetch(cacheKey, 12_000, async () => {
      const authHeader = await getAuthHeader();
      const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
      const upstream = await fetch(url, { headers: authHeader });
      if (!upstream.ok) throw new Error(`OpenSky error: ${upstream.status}`);
      return upstream.json();
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch flight data', detail: String(err) });
  }
});

export default router;
