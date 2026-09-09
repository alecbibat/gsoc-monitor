import { describe, expect, it } from 'vitest';
import {
  HEAL_MIN_REPEATS,
  MAX_PLAUSIBLE_KT,
  betterCandidate,
  evaluateCandidate,
  mtRow,
  normalizeMtSpeed,
  parseAisTimeUtc,
  parseCruiseMapper,
  parseReportedAgo,
  type CandidateFix,
  type FixDecision,
  type FixSource,
  type HeldFix,
  type PendingOverride,
  type SourceCandidate,
} from './ships';

const MIN = 60_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 9, 12, 0, 0);

// Mid-North-Pacific, roughly on the Alaska → Japan great circle.
const MID = { latitude: 52.0, longitude: -175.0 };
// Vancouver harbour — where the ship started three weeks earlier.
const VAN = { latitude: 49.29, longitude: -123.12 };

function held(pos: { latitude: number; longitude: number }, updatedAt: number): HeldFix {
  return { ...pos, updatedAt };
}

function cand(
  pos: { latitude: number; longitude: number },
  fixAt: number,
  extra: Partial<CandidateFix> = {}
): CandidateFix {
  return {
    ...pos,
    source: 'cruisemapper',
    fixAt,
    fixAtKnown: true,
    fixPrecisionMs: MIN,
    ...extra,
  };
}

function rejected(d: FixDecision): Extract<FixDecision, { accept: false }> {
  if (d.accept) throw new Error('expected a rejection');
  return d;
}

describe('evaluateCandidate — ordering by fix time', () => {
  it('accepts anything when nothing is held yet', () => {
    const d = evaluateCandidate(undefined, cand(VAN, T0), undefined, T0);
    expect(d.accept).toBe(true);
  });

  it('drops a fix that is older than the held one, however far away it is', () => {
    // Held: satellite fix mid-ocean at T0. Candidate: a port fix stamped
    // three hours earlier (a page still showing an old call).
    const d = rejected(evaluateCandidate(held(MID, T0), cand(VAN, T0 - 3 * HOUR), undefined, T0 + HOUR));
    expect(d.reason).toBe('older');
    expect(d.distanceNm).toBeGreaterThan(1500);
  });

  it('treats a same-spot report inside the source time rounding as the same fix', () => {
    // "38 minutes ago" read at T0, then "2 hours ago" read two hours later:
    // the second computes 38 min newer only because the age was rounded.
    const prev = held(MID, T0 - 38 * MIN);
    const d = rejected(
      evaluateCandidate(prev, cand(MID, T0, { fixPrecisionMs: HOUR }), undefined, T0 + 2 * HOUR)
    );
    expect(d.reason).toBe('duplicate');
  });

  it('refreshes the fix time for a moored ship reporting again from the same spot', () => {
    const d = evaluateCandidate(
      held(VAN, T0),
      cand(VAN, T0 + 3 * MIN, { source: 'aisstream', fixPrecisionMs: 2_000 }),
      undefined,
      T0 + 3 * MIN
    );
    expect(d.accept).toBe(true);
    if (d.accept) expect(d.moved).toBe(false);
  });

  it('learns nothing from a same-spot report with no source-stated time', () => {
    const d = rejected(
      evaluateCandidate(held(VAN, T0), cand(VAN, T0 + 2 * HOUR, { fixAtKnown: false, fixPrecisionMs: 0 }), undefined, T0 + 2 * HOUR)
    );
    expect(d.reason).toBe('duplicate');
  });
});

describe('evaluateCandidate — plausibility gate', () => {
  it('accepts a normal cruise-speed move', () => {
    // ~30 nm west in two hours.
    const d = evaluateCandidate(
      held(MID, T0),
      cand({ latitude: 52.0, longitude: -175.8 }, T0 + 2 * HOUR),
      undefined,
      T0 + 2 * HOUR
    );
    expect(d.accept).toBe(true);
    if (d.accept) expect(d.impliedKt).toBeLessThan(MAX_PLAUSIBLE_KT);
  });

  it('refuses the Star Seeker snap-back: mid-Pacific to Vancouver in two hours', () => {
    const d = rejected(evaluateCandidate(held(MID, T0), cand(VAN, T0 + 2 * HOUR), undefined, T0 + 2 * HOUR));
    expect(d.reason).toBe('implausible');
    expect(d.impliedKt).toBeGreaterThan(500);
    expect(d.pending?.count).toBe(1);
  });

  it('refuses the same jump when the candidate has no fix time (stamped as now)', () => {
    const d = rejected(
      evaluateCandidate(held(MID, T0), cand(VAN, T0 + 2 * HOUR, { fixAtKnown: false, fixPrecisionMs: 0 }), undefined, T0 + 2 * HOUR)
    );
    expect(d.reason).toBe('implausible');
  });

  it('accepts a long crossing after a long silence', () => {
    // 2,000 nm in five days is 17 kt — a ship that went dark mid-ocean.
    const d = evaluateCandidate(held(VAN, T0), cand(MID, T0 + 5 * 24 * HOUR), undefined, T0 + 5 * 24 * HOUR);
    expect(d.accept).toBe(true);
  });

  it('never divides by a tiny interval', () => {
    // 2 nm reported 10 s apart is GPS/clock scatter, not 700 kt.
    const d = evaluateCandidate(
      held(MID, T0),
      cand({ latitude: 52.0, longitude: -175.05 }, T0 + 10_000, { source: 'aisstream', fixPrecisionMs: 2_000 }),
      undefined,
      T0 + 10_000
    );
    expect(d.accept).toBe(true);
  });

  it('handles a fix across the antimeridian as a short hop', () => {
    const d = evaluateCandidate(
      held({ latitude: 52.0, longitude: 179.9 }, T0),
      cand({ latitude: 52.0, longitude: -179.9 }, T0 + HOUR),
      undefined,
      T0 + HOUR
    );
    expect(d.accept).toBe(true);
    if (d.accept) expect(d.impliedKt).toBeLessThan(15);
  });
});

describe('evaluateCandidate — an untimed source cannot spend the held fix\'s age', () => {
  // The reported failure: Star Seeker sits mid-Pacific out of receiver range
  // for days, so the held fix keeps ageing. A coastal coordinate carrying no
  // fix time must not become "plausible" simply because enough time passed
  // for the ship to have theoretically sailed back.
  it('refuses an ageless Vancouver coordinate however stale the mid-ocean fix is', () => {
    for (const days of [1, 3, 7, 30]) {
      const at = T0 + days * 24 * HOUR;
      const d = rejected(
        evaluateCandidate(held(MID, T0), cand(VAN, at, { fixAtKnown: false, fixPrecisionMs: 0 }), undefined, at)
      );
      expect(d.reason).toBe('implausible');
    }
  });

  it('still accepts the same jump when the source says when the ship reported', () => {
    // A stated recent fix time after three days of silence is real evidence,
    // and 2,000 nm over three days is an ordinary 28 kt.
    const at = T0 + 3 * 24 * HOUR;
    const d = evaluateCandidate(held(MID, T0), cand(VAN, at), undefined, at);
    expect(d.accept).toBe(true);
  });

  it('lets an untimed source keep nudging the ship along at cruise speed', () => {
    // ~60 nm west, the distance a 15 kt ship covers between 2-hourly polls.
    const at = T0 + 2 * HOUR;
    const d = evaluateCandidate(
      held(MID, T0),
      cand({ latitude: 52.0, longitude: -176.6 }, at, { fixAtKnown: false, fixPrecisionMs: 0 }),
      undefined,
      at
    );
    expect(d.accept).toBe(true);
  });
});

describe('evaluateCandidate — self-healing when the held fix is the wrong one', () => {
  it('accepts a source that keeps reporting a consistent, moving track far away', () => {
    // Held: a stale Vancouver fix. CruiseMapper then reports the ship
    // mid-Pacific on three consecutive 2-hourly polls, moving west each time.
    let pending: PendingOverride | undefined;
    const prev = held(VAN, T0);
    const track = [
      { latitude: 52.0, longitude: -175.0 },
      { latitude: 52.0, longitude: -175.9 },
      { latitude: 52.0, longitude: -176.8 },
    ];
    const decisions = track.map((p, i) => {
      const at = T0 + (i + 1) * 2 * HOUR;
      const d = evaluateCandidate(prev, cand(p, at), pending, at + 5 * MIN);
      pending = d.pending ?? undefined;
      return d;
    });
    expect(decisions.slice(0, HEAL_MIN_REPEATS - 1).every((d) => !d.accept)).toBe(true);
    const last = decisions[HEAL_MIN_REPEATS - 1];
    expect(last.accept).toBe(true);
    if (last.accept) expect(last.healed).toBe(true);
  });

  it('is not fooled by a page that keeps re-serving the same coordinates with no time', () => {
    let pending: PendingOverride | undefined;
    const prev = held(MID, T0);
    for (let i = 1; i <= 6; i++) {
      const at = T0 + i * 2 * HOUR;
      const d = rejected(
        evaluateCandidate(prev, cand(VAN, at, { fixAtKnown: false, fixPrecisionMs: 0 }), pending, at)
      );
      expect(d.reason).toBe('implausible');
      pending = d.pending ?? undefined;
    }
    expect(pending?.count).toBe(1);
  });

  it('restarts the count when the far-away reports are not even consistent with each other', () => {
    const prev = held(MID, T0);
    const first = rejected(evaluateCandidate(prev, cand(VAN, T0 + 2 * HOUR), undefined, T0 + 2 * HOUR));
    // Next report is thousands of miles from the first rejected one.
    const second = rejected(
      evaluateCandidate(prev, cand({ latitude: 21.3, longitude: -157.9 }, T0 + 4 * HOUR), first.pending ?? undefined, T0 + 4 * HOUR)
    );
    expect(second.pending?.count).toBe(1);
  });

  it('clears the pending override once a plausible fix arrives', () => {
    const prev = held(MID, T0);
    const first = rejected(evaluateCandidate(prev, cand(VAN, T0 + 2 * HOUR), undefined, T0 + 2 * HOUR));
    const ok = evaluateCandidate(
      prev,
      cand({ latitude: 52.0, longitude: -175.8 }, T0 + 2 * HOUR),
      first.pending ?? undefined,
      T0 + 2 * HOUR
    );
    expect(ok.accept).toBe(true);
    expect(ok.pending).toBeNull();
  });
});

describe('parseAisTimeUtc', () => {
  const now = Date.UTC(2023, 0, 1);

  it('parses the aisstream MetaData.time_utc format', () => {
    expect(parseAisTimeUtc('2022-12-29 18:22:32.318353 +0000 UTC', now)).toBe(
      Date.UTC(2022, 11, 29, 18, 22, 32, 318)
    );
  });

  it('honours a non-zero offset', () => {
    expect(parseAisTimeUtc('2022-12-29 18:22:32 +0200', now)).toBe(Date.UTC(2022, 11, 29, 16, 22, 32));
  });

  it('rejects garbage, the future and the distant past', () => {
    expect(parseAisTimeUtc(undefined, now)).toBeNull();
    expect(parseAisTimeUtc(1672337152000, now)).toBeNull();
    expect(parseAisTimeUtc('yesterday', now)).toBeNull();
    expect(parseAisTimeUtc('2023-01-01 00:10:00 +0000 UTC', now)).toBeNull();
    expect(parseAisTimeUtc('2022-06-01 00:00:00 +0000 UTC', now)).toBeNull();
  });
});

describe('parseReportedAgo', () => {
  it('reads the fix age CruiseMapper states next to the position', () => {
    expect(parseReportedAgo('The AIS position was reported 38 minutes ago.')).toEqual({
      ageMs: 38 * MIN,
      precisionMs: MIN,
      text: '38 minutes ago',
    });
    expect(parseReportedAgo('position received 2 hours ago')).toMatchObject({ ageMs: 2 * HOUR, precisionMs: HOUR });
    expect(parseReportedAgo('last update: 3 days ago')).toMatchObject({ ageMs: 3 * 24 * HOUR });
    expect(parseReportedAgo('reported an hour ago')).toMatchObject({ ageMs: HOUR });
    expect(parseReportedAgo('reported just now')).toMatchObject({ ageMs: 0 });
  });

  it('ignores "ago" strings that are not about the fix', () => {
    expect(parseReportedAgo('Review posted 3 days ago. Position: 12.3 N / 45.6 W')).toBeNull();
    expect(parseReportedAgo('nothing here')).toBeNull();
  });
});

describe('parseCruiseMapper — fix age is read from the position block only', () => {
  const ship = { mmsi: '311001759', imo: 9904819, name: 'Star Seeker' };

  it('does not date a fresh position from an unrelated "updated N days ago" elsewhere', () => {
    const html = `<h1>Star Seeker</h1>
<p>position: coordinates 51.9876 N / 170.1234 W</p>
${'<p>itinerary filler text for the cruise schedule table</p>'.repeat(60)}
<footer>Ship review last updated 6 days ago.</footer>`;
    const r = parseCruiseMapper(html, ship, T0);
    expect(r.pos?.lat).toBeCloseTo(51.9876);
    // Untimed, not dated six days into the past — which would have got a
    // genuinely new position refused as older than the held fix.
    expect(r.pos?.fixAtKnown).toBe(false);
    expect(r.pos?.t).toBe(T0);
  });

  it('reads an age that sits just before the coordinates', () => {
    const html = `<h1>Star Seeker</h1>
<p>The AIS position was reported 20 minutes ago: current position coordinates 51.9 N / 170.1 W</p>`;
    expect(parseCruiseMapper(html, ship, T0).pos?.t).toBe(T0 - 20 * MIN);
  });
});

describe('parseCruiseMapper', () => {
  const ship = { mmsi: '311001759', imo: 9904819, name: 'Star Seeker' };
  const now = T0;

  // A page shaped like CruiseMapper's: organisation JSON-LD (with the cruise
  // line's office coordinates) and the itinerary's port markers come BEFORE
  // the ship's own position prose.
  const page = `<!DOCTYPE html><html><head>
<title>Star Seeker Itinerary, Current Position, Ship Review | CruiseMapper</title>
<script type="application/ld+json">{"@type":"Organization","name":"Windstar Cruises","geo":{"latitude":25.7617,"longitude":-80.1918}}</script>
</head><body><h1>Star Seeker</h1>
<script>var ports=[{"name":"Vancouver","lat":49.2827,"lng":-123.1207},{"name":"Seward","lat":60.1042,"lng":-149.4422}];</script>
<div class="specs">Max speed: 18.5 kn</div>
<p>Star Seeker current position is at North Pacific Ocean (coordinates 51.9876 N / 170.1234 W)
cruising at speed of 14.2 kn (26 km/h | 16 mph) en route to Tokyo. The AIS position was reported 2 hours ago.</p>
</body></html>`;

  it('takes the position prose over office and port coordinates that appear earlier', () => {
    const r = parseCruiseMapper(page, ship, now);
    expect(r.strategy).toBe('prose');
    expect(r.pos?.lat).toBeCloseTo(51.9876);
    expect(r.pos?.lon).toBeCloseTo(-170.1234);
    expect(r.pos?.speedKt).toBe(14.2);
    expect(r.pos?.destination?.startsWith('Tokyo')).toBe(true);
  });

  it('dates the fix from the page rather than the scrape', () => {
    const r = parseCruiseMapper(page, ship, now);
    expect(r.pos?.t).toBe(now - 2 * HOUR);
    expect(r.pos?.fixAtKnown).toBe(true);
    expect(r.pos?.fixPrecisionMs).toBe(HOUR);
    expect(r.ageText).toBe('2 hours ago');
  });

  it('reads signed decimals in the prose when hemisphere letters are absent', () => {
    const html = `<h1>Star Seeker</h1><p>current position: coordinates -15.877 / -149.560</p>`;
    const r = parseCruiseMapper(html, ship, now);
    expect(r.pos?.lat).toBeCloseTo(-15.877);
    expect(r.pos?.lon).toBeCloseTo(-149.56);
  });

  it('prefers the ship marker keys over the itinerary port markers', () => {
    const html = `<h1>Star Seeker</h1>
<script>var ports=[{"name":"Vancouver","lat":49.2827,"lng":-123.1207}]; var nlat = 51.9876; var nlng = -170.1234;</script>`;
    const r = parseCruiseMapper(html, ship, now);
    expect(r.strategy).toBe('keyed');
    expect(r.pos?.lat).toBeCloseTo(51.9876);
    expect(r.pos?.lon).toBeCloseTo(-170.1234);
    expect(r.pos?.fixAtKnown).toBe(false);
    expect(r.note).toMatch(/no fix age/);
  });

  it('never splices a latitude from one object with a longitude from another', () => {
    // JSON-LD gives only a latitude-ish key far from the marker init; the
    // marker's own pair must win over a cross-object splice.
    const html = `<h1>Star Seeker</h1>
<script type="application/ld+json">{"geo":{"latitude":25.7617,"elevation":3}}</script>
${'<p>filler</p>'.repeat(40)}
<script>var marker={"lat":51.9876,"lng":-170.1234};</script>`;
    const r = parseCruiseMapper(html, ship, now);
    expect(r.pos?.lat).toBeCloseTo(51.9876);
    expect(r.pos?.lon).toBeCloseTo(-170.1234);
  });

  it('cuts the destination at the end of the sentence but keeps abbreviations', () => {
    const a = parseCruiseMapper(
      `<h1>Star Seeker</h1><p>position: coordinates 51.9 N / 170.1 W en route to Tokyo. The AIS position was reported 1 hour ago.</p>`,
      ship,
      now
    );
    expect(a.pos?.destination).toBe('Tokyo');
    const b = parseCruiseMapper(
      `<h1>Star Seeker</h1><p>position: coordinates 18.3 N / 64.9 W en route to St. Thomas. The AIS position was reported 1 hour ago.</p>`,
      ship,
      now
    );
    expect(b.pos?.destination).toBe('St. Thomas');
  });

  it('does not mistake lower-case prose for a hemisphere position', () => {
    const html = `<h1>Star Seeker</h1><p>Cabins on deck 2 n, 4 e are forward.</p>`;
    expect(parseCruiseMapper(html, ship, now).pos).toBeNull();
  });

  it('keeps an excerpt of the page around the coordinates it used', () => {
    const r = parseCruiseMapper(page, ship, now);
    expect(r.excerpt).toContain('coordinates 51.9876 N / 170.1234 W');
    expect(r.excerpt).not.toContain('<p>');
  });

  it('does not read "lat"/"lon" out of the middle of other identifiers', () => {
    const html = `<h1>Star Seeker</h1><script>var flat = 12.345; var slon = -1.234; var translate = 99.999;</script>`;
    const r = parseCruiseMapper(html, ship, now);
    expect(r.pos).toBeNull();
    expect(r.note).toMatch(/no coordinates/);
  });

  it('refuses a page that is not the ship page at all', () => {
    const html = `<title>Just a moment...</title><p>Checking your browser before accessing cruisemapper.com</p>
<script>var lat = 51.5074, lng = -0.1278;</script>`;
    const r = parseCruiseMapper(html, ship, now);
    expect(r.pos).toBeNull();
    expect(r.note).toMatch(/does not mention the ship/);
  });

  it('accepts the page when only the IMO identifies it', () => {
    const html = `<p>Vessel IMO 9904819</p><p>position: coordinates 51.9876 N / 170.1234 W</p>`;
    expect(parseCruiseMapper(html, ship, now).pos?.lat).toBeCloseTo(51.9876);
  });

  it('drops a speed no cruise ship can do (a wind or spec figure)', () => {
    const html = `<h1>Star Seeker</h1><p>position: coordinates 51.9876 N / 170.1234 W. Wind 45 knots.</p>`;
    expect(parseCruiseMapper(html, ship, now).pos?.speedKt).toBeNull();
  });

  // A page with nothing but port markers cannot be told apart from a ship
  // marker page; that is what applyFix's plausibility gate is for.
  it('still parses a bare marker page, with no fix age, for the gate to judge', () => {
    const html = `<h1>Star Seeker</h1><script>var m={"lat":49.2827,"lng":-123.1207};</script>`;
    const r = parseCruiseMapper(html, ship, now);
    expect(r.pos?.lat).toBeCloseTo(49.2827);
    expect(r.pos?.fixAtKnown).toBe(false);
  });
});

describe('normalizeMtSpeed', () => {
  // MarineTraffic's SPEED scaling differs by protocol version, so the reader
  // has to survive raw knots, knots x10 and knots x100 without a config flag.
  it('reads each scaling as the same vessel speed', () => {
    expect(normalizeMtSpeed(14.2)).toBeCloseTo(14.2);
    expect(normalizeMtSpeed(142)).toBeCloseTo(14.2);
    expect(normalizeMtSpeed(1420)).toBeCloseTo(14.2);
  });

  it('keeps a stopped ship at zero and rejects nonsense', () => {
    expect(normalizeMtSpeed(0)).toBe(0);
    expect(normalizeMtSpeed(null)).toBeNull();
    expect(normalizeMtSpeed(-3)).toBeNull();
    expect(normalizeMtSpeed(NaN)).toBeNull();
    // 500 kt is not a ship at any scaling that leaves it above 40.
    expect(normalizeMtSpeed(500_000)).toBeNull();
  });
});

describe('mtRow', () => {
  const ship = { mmsi: '311001759', imo: 9904819, name: 'Star Seeker' };
  const now = Date.UTC(2026, 8, 9, 12, 0, 0);

  it('maps a roaming position report', () => {
    const r = mtRow(
      {
        MMSI: '311001759',
        LAT: '51.98760',
        LON: '-170.12340',
        SPEED: '142',
        COURSE: '265',
        HEADING: '267',
        STATUS: '0',
        TIMESTAMP: '2026-09-09T10:30:00.000Z',
        DSRC: 'ROAM',
      },
      ship,
      now
    );
    expect(r.lat).toBeCloseTo(51.9876);
    expect(r.lon).toBeCloseTo(-170.1234);
    expect(r.speedKt).toBeCloseTo(14.2);
    expect(r.reception).toBe('roaming');
    expect(r.t).toBe(Date.UTC(2026, 8, 9, 10, 30, 0));
    expect(r.fixAtKnown).toBe(true);
    // Identity comes from our own fleet table, never from the response.
    expect(r.imo).toBe(9904819);
    expect(r.mmsi).toBe('311001759');
  });

  it('recognises the terrestrial and satellite source codes', () => {
    const at = (dsrc: string) =>
      mtRow({ LAT: 1, LON: 2, TIMESTAMP: '2026-09-09T10:30:00Z', DSRC: dsrc }, ship, now).reception;
    expect(at('TER')).toBe('terrestrial');
    expect(at('SAT')).toBe('satellite');
    expect(at('ROAM')).toBe('roaming');
    expect(at('')).toBeNull();
    expect(at('something-else')).toBeNull();
  });

  it('falls back to the poll time when the row carries no timestamp', () => {
    const r = mtRow({ LAT: 1, LON: 2 }, ship, now);
    expect(r.t).toBe(now);
    expect(r.fixAtKnown).toBe(false);
  });

  it('accepts an epoch-seconds timestamp', () => {
    const r = mtRow({ LAT: 1, LON: 2, TIMESTAMP: 1_757_414_400 }, ship, now);
    expect(r.t).toBe(1_757_414_400_000);
    expect(r.fixAtKnown).toBe(true);
  });
});

describe('betterCandidate', () => {
  const ORDER: FixSource[] = ['marinetraffic', 'vesselfinder', 'myshiptracking', 'cruisemapper'];
  const rank = (s: FixSource) => {
    const i = ORDER.indexOf(s);
    return i === -1 ? ORDER.length : i;
  };
  const at = Date.UTC(2026, 8, 9, 12, 0, 0);

  function candidate(source: FixSource, over: Partial<CandidateRow> = {}): SourceCandidate {
    return {
      source,
      row: {
        imo: 9904819,
        mmsi: '311001759',
        lat: 52,
        lon: -175,
        speedKt: 14,
        courseDeg: 265,
        headingDeg: 265,
        navStatus: 0,
        destination: null,
        etaText: null,
        name: 'Star Seeker',
        t: at,
        fixAtKnown: true,
        fixPrecisionMs: 0,
        reception: null,
        ...over,
      },
    };
  }
  type CandidateRow = SourceCandidate['row'];

  it('prefers a source that says when the ship reported', () => {
    // The scrape's untimed answer is stamped with our clock, so it looks
    // newest. It must not beat a real timestamp from half an hour ago.
    const timed = candidate('marinetraffic', { t: at - 30 * MIN, fixAtKnown: true });
    const untimed = candidate('cruisemapper', { t: at, fixAtKnown: false, lat: 49.29, lon: -123.12 });
    expect(betterCandidate(untimed, timed, rank)).toBe(timed);
    expect(betterCandidate(timed, untimed, rank)).toBe(timed);
  });

  it('prefers the newer fix when both state a time', () => {
    const older = candidate('marinetraffic', { t: at - 3 * HOUR });
    const newer = candidate('cruisemapper', { t: at - 10 * MIN });
    expect(betterCandidate(older, newer, rank)).toBe(newer);
    expect(betterCandidate(newer, older, rank)).toBe(newer);
  });

  it('breaks an exact tie on coverage rank', () => {
    const mt = candidate('marinetraffic');
    const cm = candidate('cruisemapper');
    expect(betterCandidate(cm, mt, rank)).toBe(mt);
    expect(betterCandidate(mt, cm, rank)).toBe(mt);
  });

  it('lets a fresher lower-ranked source beat a stale better-covered one', () => {
    const staleMt = candidate('marinetraffic', { t: at - 8 * HOUR });
    const freshCm = candidate('cruisemapper', { t: at - 5 * MIN });
    expect(betterCandidate(staleMt, freshCm, rank)).toBe(freshCm);
  });
});
