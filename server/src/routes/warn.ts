import { Router } from 'express';
import { cache } from '../cache';
import { config } from '../config';

// ── PBS WARN: Wireless Emergency Alerts ──────────────────────────────────────
//
// PBS WARN (Warning, Alert and Response Network) is PBS member stations'
// redundant path for Wireless Emergency Alerts: every WEA that FEMA's IPAWS
// hands to the cell carriers is also broadcast by PBS, and warn.pbs.org maps
// them. Unlike the NWS feed this includes the alerts state and local agencies
// send — AMBER alerts, evacuations, shelter-in-place, law-enforcement and
// hazmat warnings, 911 outages — as well as the NWS's and USGS's own WEAs.
//
// This proxies the API behind that map: the same requests its page makes, no
// key. It is undocumented, so it can change without notice — a failure shows
// on the layer as an upstream error, and the last good answer is served
// meanwhile. Proxied (not fetched by the browser) because its CORS header
// changes from one burst of requests to the next, and so one fetch per TTL
// serves every viewer. FEMA's own sources don't fit a live layer: the OpenFEMA
// IPAWS archive is published 24 h late by design, and the live IPAWS-OPEN
// feeds need a FEMA-issued PIN.
export const WARN_API = 'https://nmknkohb83.execute-api.us-east-1.amazonaws.com/prod/warn_out/';
const PAGE_SIZE = 50; // the API's cap
// 500 active WEAs — far beyond any day seen (a handful is typical).
const MAX_PAGES = 10;
const TTL_MS = 45_000;
const TIMEOUT_MS = 15_000;

export type WeaClass = 'presidential' | 'imminent-threat' | 'public-safety' | 'amber';

export interface WarnCircle {
  lon: number;
  lat: number;
  radiusKm: number;
}

/** One live WEA, flattened for the map. */
export interface WarnAlert {
  id: string;
  capId: string;
  event: string;
  /** The issuing agency as the alert names itself (CAP senderName). */
  sender: string;
  weaClass: WeaClass;
  category: string | null;
  severity: string | null;
  urgency: string | null;
  certainty: string | null;
  responseType: string | null;
  /** An alert, or an update replacing an earlier version. */
  msgType: 'alert' | 'update';
  sent: string | null;
  expires: string | null;
  /** The WEA as it appeared on phones (the 90/360-character message). */
  weaText: string | null;
  /** The longer WEA message, when one was sent. */
  weaLongText: string | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  /** The Spanish WEA message, when one was sent. */
  spanishText: string | null;
  areaDesc: string | null;
  /** 5-digit county FIPS codes the alert was sent to. */
  counties: string[];
  /** Alert areas as rings of [lon, lat]. */
  polygons: number[][][];
  circles: WarnCircle[];
  /** Issued by the NWS — the NWS alerts layer draws it too. */
  nws: boolean;
}

export interface WarnFeed {
  alerts: WarnAlert[];
  /** When PBS's backend last checked in (it says so on every response); null if absent. */
  heartbeat: string | null;
  fetchedAt: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A ring of [lat, lon] pairs (PBS's order) as [lon, lat]; null when unusable. */
function latLonRing(v: unknown): number[][] | null {
  if (!Array.isArray(v)) return null;
  const ring: number[][] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const lat = Number(p[0]);
    const lon = Number(p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    ring.push([lon, lat]);
  }
  return ring.length >= 3 ? ring : null;
}

function weaClass(handling: unknown): WeaClass | 'test' {
  if (handling === null || handling === undefined) return 'imminent-threat';
  if (handling === 'Child Abduction') return 'amber';
  if (handling === 'Presidential') return 'presidential';
  if (handling === 'State Local WEA Test') return 'test';
  return 'public-safety';
}

function pickText(texts: unknown, type: string, language = 'English'): string | null {
  if (!Array.isArray(texts)) return null;
  const of = texts.filter((t) => isObj(t) && t.type === type);
  const hit = of.find((t) => (t as Record<string, unknown>).language === language) ??
    (language === 'English' ? of[0] : undefined);
  return hit ? str((hit as Record<string, unknown>).value) : null;
}

const NWS_CAP_ID = /^urn:oid:2\.49\.0\.1\.840\.0\./;

/**
 * One record from the WARN API as a live WEA for the map, or null when it
 * isn't one: cancelled or superseded, a cancel message, expired, a test, or
 * without an area to draw.
 */
export function normalizeWarnAlert(raw: unknown, now = Date.now()): WarnAlert | null {
  if (!isObj(raw)) return null;
  if (raw.is_cancelled === true || raw.is_out_of_date === true) return null;
  if (raw.msg_type !== 'alert' && raw.msg_type !== 'update') return null;
  if (raw.status !== undefined && raw.status !== 'Actual') return null;
  const cls = weaClass(raw.cmac_special_handling);
  if (cls === 'test' || raw.category === 'test') return null;
  const expires = str(raw.expires);
  const expiresAt = expires ? Date.parse(expires) : NaN;
  if (Number.isFinite(expiresAt) && expiresAt <= now) return null;

  const polygons: number[][][] = [];
  const circles: WarnCircle[] = [];
  const counties: string[] = [];
  let areaDesc: string | null = null;
  for (const area of Array.isArray(raw.areas) ? raw.areas : []) {
    if (!isObj(area)) continue;
    if (area.type === 'polygon') {
      const ring = latLonRing(area.value);
      if (ring) polygons.push(ring);
    } else if (area.type === 'circle' && isObj(area.value) && isObj(area.value.center)) {
      const lat = Number(area.value.center.latitude);
      const lon = Number(area.value.center.longitude);
      const radiusKm = Number(area.value.radius);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(radiusKm) && radiusKm > 0 &&
          Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        circles.push({ lon, lat, radiusKm });
      }
    } else if (area.type === 'cmas_geocode') {
      const fips = str(area.value);
      if (fips && /^\d{5}$/.test(fips) && !counties.includes(fips)) counties.push(fips);
      // County-only alerts come with the county's outline attached.
      if (Array.isArray(area.polygons)) {
        for (const r of area.polygons) {
          const ring = latLonRing(r);
          if (ring) polygons.push(ring);
        }
      }
    } else if (area.type === 'area_description') {
      areaDesc ??= str(area.value);
    }
  }
  if (polygons.length === 0 && circles.length === 0) return null;

  const id = str(raw.cmac_message_number) ?? (raw.id !== undefined ? String(raw.id) : null);
  if (!id) return null;
  const capId = str(raw.cap_identifier) ?? '';
  const sender = str(raw.sender) ?? 'Unknown sender';
  return {
    id,
    capId,
    event: str(raw.event) ?? 'Emergency Alert',
    sender,
    weaClass: cls,
    category: str(raw.category),
    severity: str(raw.severity),
    urgency: str(raw.urgency),
    certainty: str(raw.certainty),
    responseType: str(raw.response_type),
    msgType: raw.msg_type,
    sent: str(raw.sent),
    expires,
    weaText: pickText(raw.texts, 'cmac_short_text'),
    weaLongText: pickText(raw.texts, 'cmac_long_text'),
    headline: pickText(raw.texts, 'cap_headline'),
    description: pickText(raw.texts, 'cap_description'),
    instruction: pickText(raw.texts, 'cap_instruction'),
    spanishText: pickText(raw.texts, 'cmac_long_text', 'Spanish') ?? pickText(raw.texts, 'cmac_short_text', 'Spanish'),
    // PBS fills a placeholder ("AffectedArea") where the sender gave none.
    areaDesc: areaDesc && !/^affected ?area$/i.test(areaDesc) ? areaDesc : null,
    counties,
    polygons,
    circles,
    nws: NWS_CAP_ID.test(capId) || /^NWS\b/.test(sender),
  };
}

/** The live WEAs on one page of the API, deduped by id. */
export function normalizeWarnPage(body: unknown, now = Date.now()): { alerts: WarnAlert[]; pages: number; heartbeat: string | null } {
  if (!isObj(body) || !Array.isArray(body.alerts)) throw new Error('WARN response has no alerts list');
  const pages = isObj(body.pages) && Number.isInteger(body.pages.pages) ? Number(body.pages.pages) : 1;
  const hb = str(body.last_heartbeat);
  const hbAt = hb ? Date.parse(hb) : NaN;
  const seen = new Set<string>();
  const alerts: WarnAlert[] = [];
  for (const raw of body.alerts) {
    const a = normalizeWarnAlert(raw, now);
    if (a && !seen.has(a.id)) {
      seen.add(a.id);
      alerts.push(a);
    }
  }
  return { alerts, pages: Math.max(1, pages), heartbeat: Number.isFinite(hbAt) ? new Date(hbAt).toISOString() : null };
}

async function fetchPage(page: number): Promise<unknown> {
  // Page URLs are built here rather than followed from the response's
  // next_url, so an upstream answer can never point this server elsewhere.
  const url = `${WARN_API}?status=active&page=${page}&per_page=${PAGE_SIZE}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': config.nwsUserAgent, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`PBS WARN error: ${res.status}`);
  return res.json();
}

async function fetchActiveWarn(): Promise<WarnFeed> {
  const first = normalizeWarnPage(await fetchPage(1));
  const alerts = [...first.alerts];
  const ids = new Set(alerts.map((a) => a.id));
  for (let page = 2; page <= Math.min(first.pages, MAX_PAGES); page++) {
    for (const a of normalizeWarnPage(await fetchPage(page)).alerts) {
      if (!ids.has(a.id)) {
        ids.add(a.id);
        alerts.push(a);
      }
    }
  }
  return { alerts, heartbeat: first.heartbeat, fetchedAt: new Date().toISOString() };
}

const router = Router();

// GET /api/warn/active — the WEAs in force now, with PBS's heartbeat.
router.get('/active', async (_req, res) => {
  try {
    const feed = await cache.getOrFetch<WarnFeed>('warn:active', TTL_MS, fetchActiveWarn, { staleOnError: true });
    // A stale answer can hold alerts that have since expired.
    const now = Date.now();
    const alerts = feed.alerts.filter((a) => !a.expires || !(Date.parse(a.expires) <= now));
    res.json({ ...feed, alerts });
  } catch (err) {
    res.status(502).json({ error: 'PBS WARN unavailable', detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
