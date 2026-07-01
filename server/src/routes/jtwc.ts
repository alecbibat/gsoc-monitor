import { Router } from 'express';
import { cache } from '../cache';
import { config } from '../config';

const router = Router();

// JTWC Significant Tropical Weather Advisories — plain-text bulletins listing
// "invest" areas (developing disturbances, numbered 90-99 with a basin suffix)
// in the basins NHC does NOT cover: West Pacific, N/S Indian Ocean, S Pacific.
// Two files cover all four: ABPW10 (Western + South Pacific) and ABIO10 (North +
// South Indian). They're non-CORS plain text, so we fetch + parse + cache them
// server-side and hand the client clean JSON (mirrors the NHC GTWO disturbances
// the hurricane layer already draws).
const SOURCES = [
  'https://www.metoc.navy.mil/jtwc/products/abpwweb.txt',
  'https://www.metoc.navy.mil/jtwc/products/abioweb.txt',
];
const TTL_MS = 60 * 60 * 1000; // advisories are issued ~every 6h

export type InvestPotential = 'Low' | 'Medium' | 'High' | 'Unknown';

export interface JtwcInvest {
  id: string; // e.g. "96W"
  basin: string; // human-readable basin name
  lat: number;
  lon: number;
  potential: InvestPotential;
}

export interface JtwcInvestsResponse {
  invests: JtwcInvest[];
  updated: number;
  error?: string;
}

// Basin from the invest-id suffix letter (JTWC's ATCF basin codes).
const BASIN: Record<string, string> = {
  W: 'West Pacific',
  B: 'Bay of Bengal',
  A: 'Arabian Sea',
  S: 'South Indian Ocean',
  P: 'South Pacific',
};

const COORD = /(\d{1,3}(?:\.\d+)?)\s*([NS])\s+(\d{1,3}(?:\.\d+)?)\s*([EW])/;

function toLatLon(m: RegExpMatchArray): { lat: number; lon: number } {
  return {
    lat: parseFloat(m[1]) * (m[2] === 'S' ? -1 : 1),
    lon: parseFloat(m[3]) * (m[4] === 'W' ? -1 : 1),
  };
}

// Extract each invest from a Significant Tropical Weather Advisory. The bulletin
// is hard-wrapped, so we collapse whitespace first, then slice the text into
// one segment per "(INVEST xxX)" mention and pull the current centre + the
// stated development potential out of each.
export function parseAdvisory(text: string): JtwcInvest[] {
  const flat = text.replace(/\s+/g, ' ');
  const investRe = /\(INVEST\s+(\d{2}[A-Z])\)/g;
  const marks: { id: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = investRe.exec(flat))) marks.push({ id: m[1], index: m.index });

  const out: JtwcInvest[] = [];
  for (let i = 0; i < marks.length; i++) {
    const { id, index } = marks[i];
    const seg = flat.slice(index, i + 1 < marks.length ? marks[i + 1].index : flat.length);

    // Current centre: prefer "...IS NOW LOCATED NEAR <coord>" (the updated fix)
    // over the "PREVIOUSLY LOCATED NEAR" one; otherwise take the first coordinate.
    const now = seg.match(new RegExp(`NOW\\s+LOCATED\\s+NEAR\\s+${COORD.source}`));
    const coord = now ?? seg.match(COORD);
    if (!coord) continue;
    const { lat, lon } = toLatLon(coord);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    // Development potential is the LOW/MEDIUM/HIGH stated after "THE POTENTIAL
    // FOR THE DEVELOPMENT..." (earlier LOW-LEVEL / LOW SHEAR mentions precede it).
    const pot = seg.match(/POTENTIAL FOR THE DEVELOPMENT[\s\S]*?\b(LOW|MEDIUM|HIGH)\b/);
    const potential: InvestPotential = pot
      ? ((pot[1][0] + pot[1].slice(1).toLowerCase()) as InvestPotential)
      : 'Unknown';

    out.push({ id, basin: BASIN[id.slice(-1)] ?? id.slice(-1), lat, lon, potential });
  }
  return out;
}

async function fetchInvests(): Promise<JtwcInvestsResponse> {
  const results = await Promise.allSettled(
    SOURCES.map(async (url) => {
      const res = await fetch(url, {
        headers: { 'User-Agent': config.nwsUserAgent, Accept: 'text/plain' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`JTWC HTTP ${res.status} (${url})`);
      return parseAdvisory(await res.text());
    })
  );

  // Both advisories down → throw so the cache can serve the last good value.
  if (results.every((r) => r.status === 'rejected')) {
    throw new Error('JTWC advisories unreachable');
  }

  const invests: JtwcInvest[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const inv of r.value) {
      if (seen.has(inv.id)) continue; // an invest can be listed in both files
      seen.add(inv.id);
      invests.push(inv);
    }
  }
  return { invests, updated: Date.now() };
}

router.get('/', async (_req, res) => {
  try {
    const data = await cache.getOrFetch<JtwcInvestsResponse>('jtwc-invests', TTL_MS, fetchInvests, {
      staleOnError: true,
    });
    res.json(data);
  } catch (err) {
    console.error('JTWC invests route error', err);
    // Non-fatal for the client: return an empty set so the hurricane layer's
    // NHC data still renders even when JTWC is unreachable with no cached value.
    res.json({ invests: [], updated: Date.now(), error: 'JTWC invests unavailable' });
  }
});

export default router;
