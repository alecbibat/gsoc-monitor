import { Router } from 'express';
import { cache } from '../cache';
import { config } from '../config';

const router = Router();

// CelesTrak publishes Two-Line Element (TLE) orbital data for satellite groups.
// It's free and needs no key, but they ask clients to cache aggressively and not
// poll more than a few times a day — TLEs are only regenerated every few hours.
// We map friendly group ids to CelesTrak GROUP names and cache each for 2 hours.
const GROUPS: Record<string, string> = {
  stations: 'stations', // ISS, Tiangong & other crewed/space stations
  visual: 'visual', // ~brightest, naked-eye-visible satellites
  gps: 'gps-ops', // GPS operational constellation
  weather: 'weather', // NOAA / Meteor / weather satellites
  starlink: 'starlink', // SpaceX Starlink constellation (large)
};

const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours, per CelesTrak's caching guidance

interface Tle {
  name: string;
  satnum: string; // NORAD catalog id
  intlDesig: string; // international designator
  line1: string;
  line2: string;
}

// CelesTrak returns plain-text TLE: three lines per object (name, line 1, line 2).
function parseTle(text: string): Tle[] {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim().length > 0);

  const out: Tle[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    // Sanity-check the canonical TLE line markers before trusting the triple.
    if (line1[0] !== '1' || line2[0] !== '2') {
      i -= 2; // misaligned; advance by one line and retry
      continue;
    }
    out.push({
      name,
      satnum: line1.substring(2, 7).trim(),
      intlDesig: line1.substring(9, 17).trim(),
      line1,
      line2,
    });
  }
  return out;
}

router.get('/', async (req, res) => {
  const group = String(req.query.group ?? 'stations');
  const celestrakGroup = GROUPS[group];
  if (!celestrakGroup) {
    res.status(400).json({ error: `Unknown group. Valid: ${Object.keys(GROUPS).join(', ')}` });
    return;
  }

  const cacheKey = `satellites:${group}`;
  try {
    const data = await cache.getOrFetch(cacheKey, TTL_MS, async () => {
      const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${celestrakGroup}&FORMAT=tle`;
      const upstream = await fetch(url, {
        headers: { 'User-Agent': config.nwsUserAgent, Accept: 'text/plain' },
      });
      if (!upstream.ok) throw new Error(`CelesTrak error: ${upstream.status}`);
      const text = await upstream.text();
      // CelesTrak signals an empty/invalid query with a short HTML/notice body
      // rather than an HTTP error, so guard against junk before parsing.
      if (!text || text.includes('<') || text.trim().length < 60) {
        throw new Error('CelesTrak returned no TLE data');
      }
      const satellites = parseTle(text);
      if (satellites.length === 0) throw new Error('No satellites parsed');
      return { group, satellites, updated: Date.now() };
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch satellite data', detail: String(err) });
  }
});

export default router;
