import { parkAreaFor } from '../area';
import { fetchJson } from '../http';
import type { RoadSource } from '../service';
import type { RoadClosure, RoadImpact } from '../types';

// ── Caltrans Lane Closure System (CWWP2) ─────────────────────────────────────
// Caltrans' public feed of every lane and full closure on the state highways,
// per district, refreshed about every 5 minutes; no key. District 9 covers
// Inyo County (CA-190 through Death Valley, CA-136, CA-178, US-395) and
// District 8 San Bernardino County (CA-127 south of Shoshone). Planned
// closures only — a flood or crash closure isn't in it — and each carries a
// begin and end point, not the road's path. (District 8, for CA-127 south of
// Shoshone, has had nothing inside Death Valley's area and is a 3 MB file, so
// it isn't polled.)

const TTL_MS = 10 * 60_000;
const lcsUrl = (district: number) =>
  `https://cwwp2.dot.ca.gov/data/d${district}/lcs/lcsStatusD${String(district).padStart(2, '0')}.json`;

interface LcsEnd {
  [k: string]: string | undefined;
}

export interface LcsRecord {
  lcs?: {
    index?: string;
    location?: { travelFlowDirection?: string; begin?: LcsEnd; end?: LcsEnd };
    closure?: {
      closureTimestamp?: { closureStartEpoch?: string; closureEndEpoch?: string; isClosureEndIndefinite?: string };
      facility?: string;
      typeOfClosure?: string;
      typeOfWork?: string;
      estimatedDelay?: string;
      lanesClosed?: string;
      code1097?: { isCode1097?: string };
      code1098?: { isCode1098?: string };
      code1022?: { isCode1022?: string };
    };
  };
}

const ROADWAY = new Set(['mainline', 'conventional hwy', 'truck bypass']);
const RAMP = new Set(['off ramp', 'on ramp', 'connector']);
const LANE_WORDS: Record<string, string> = {
  lane: 'lane closure',
  'one-way traffic': 'one-way traffic control',
  'alternating lanes': 'alternating lane closures',
  moving: 'moving lane closure',
};

/**
 * What a closure means for getting through, from its facility and type: a full
 * closure of the highway itself is "closed"; lane closures, one-way control
 * and a closed ramp or connector are "restricted". Rest areas, surface streets
 * and traffic breaks (brief rolling stops) are left out. Null = skip.
 */
export function lcsKind(facility: string | undefined, type: string | undefined): { impact: RoadImpact; what: string } | null {
  const f = (facility ?? '').trim().toLowerCase();
  const t = (type ?? '').trim().toLowerCase();
  if (ROADWAY.has(f) || f === '') {
    if (t === 'full') return { impact: 'closed', what: 'closed' };
    const words = LANE_WORDS[t];
    return words ? { impact: 'restricted', what: words } : null;
  }
  if (RAMP.has(f) && t === 'full') return { impact: 'restricted', what: `${f} closed` };
  return null;
}

const num = (s: string | undefined) => {
  const n = Number(s);
  return s !== undefined && s !== '' && Number.isFinite(n) ? n : null;
};

const epochIso = (s: string | undefined) => {
  const n = num(s);
  return n !== null && n > 0 ? new Date(n * 1000).toISOString() : null;
};

/** About 3 km: short enough that a straight line between the ends follows the road. */
const MAX_STRAIGHT_DEG = 0.03;

export function normalizeCaltransLcs(json: { data?: LcsRecord[] }, now: number): RoadClosure[] {
  const out: RoadClosure[] = [];
  for (const row of json.data ?? []) {
    const l = row.lcs;
    const c = l?.closure;
    if (!l || !c) continue;
    // 1097: the closure is set up; 1098: picked up; 1022: cancelled.
    const inPlace = c.code1097?.isCode1097 === 'true' && c.code1098?.isCode1098 !== 'true' && c.code1022?.isCode1022 !== 'true';
    if (!inPlace) continue;
    const kind = lcsKind(c.facility, c.typeOfClosure);
    if (!kind) continue;
    const { impact } = kind;
    const ts = c.closureTimestamp ?? {};
    const end = ts.isClosureEndIndefinite === 'true' ? null : epochIso(ts.closureEndEpoch);
    if (end && Date.parse(end) <= now) continue;

    const b = l.location?.begin ?? {};
    const e = l.location?.end ?? {};
    const bLon = num(b.beginLongitude), bLat = num(b.beginLatitude);
    const eLon = num(e.endLongitude), eLat = num(e.endLatitude);
    if (bLon === null || bLat === null) continue;
    const point: [number, number] = [bLon, bLat];
    const lines =
      eLon !== null && eLat !== null && Math.hypot(eLon - bLon, eLat - bLat) <= MAX_STRAIGHT_DEG && (eLon !== bLon || eLat !== bLat)
        ? [[[bLon, bLat], [eLon, eLat]]]
        : [];
    const parkCode = parkAreaFor(lines, point);
    if (!parkCode) continue;

    const route = (b.beginRoute ?? '').trim() || 'State highway';
    const from = (b.beginLocationName ?? '').trim();
    const to = (e.endLocationName ?? '').trim();
    const delay = (c.estimatedDelay ?? '').trim();
    const description = [
      from && to && from !== to ? `${from} to ${to}.` : from ? `At ${from}.` : '',
      c.typeOfWork ? `${c.typeOfWork.trim()}.` : '',
      impact === 'restricted' && c.lanesClosed ? `Lanes closed: ${c.lanesClosed.trim()}.` : '',
      delay && !/not reported/i.test(delay) ? `Expected delay: ${delay}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const routeNumber = /(\d+)/.exec(route)?.[1];
    out.push({
      id: `caltrans:${l.index ?? `${route}-${bLon},${bLat}-${ts.closureStartEpoch ?? ''}`}`,
      source: 'caltrans',
      sourceLabel: 'Caltrans lane closures',
      parkCode,
      title: impact === 'closed' ? `${route} closed` : `${route}: ${kind.what}`,
      roadNames: [route],
      description,
      impact,
      eventType: (c.typeOfWork ?? '').trim().toLowerCase() || 'planned closure',
      direction: (l.location?.travelFlowDirection ?? '').trim() || null,
      start: epochIso(ts.closureStartEpoch),
      end,
      updated: null,
      lines,
      point,
      url: routeNumber ? `https://roads.dot.ca.gov/roadscell.php?roadnumber=${routeNumber}` : null,
    });
  }
  return out;
}

export const caltransD9Source: RoadSource = {
  key: 'caltrans-d9',
  label: 'Caltrans closures (Inyo County)',
  ttlMs: () => TTL_MS,
  fetch: async (now) => normalizeCaltransLcs(await fetchJson<{ data?: LcsRecord[] }>(lcsUrl(9)), now),
};
