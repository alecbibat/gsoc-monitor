// Service status ("down detector") for the top bar: is a SaaS / cloud provider
// the team depends on having an incident right now?
//
// Downdetector itself has no public feed and forbids scraping, so this reads
// each provider's own public status page instead. Most run on Atlassian
// Statuspage and share one JSON shape; the big clouds each publish their own.
// Every parser here is a pure function of the upstream body, so the shapes are
// pinned by serviceStatus.test.ts.

export type ServiceLevel = 'ok' | 'minor' | 'major' | 'unknown';

export interface ServiceIncident {
  title: string;
  level: ServiceLevel;
  url?: string;
  /** ISO time the provider says it started. */
  since?: string;
}

export interface ServiceCheck {
  level: ServiceLevel;
  /** One line: the provider's own wording, or the lead incident. */
  summary: string;
  incidents: ServiceIncident[];
}

export interface ServiceStatus extends ServiceCheck {
  id: string;
  name: string;
  /** The human status page, linked from the menu. */
  url: string;
  /** When this answer was fetched (ms). Older than the poll means the page is failing. */
  checkedAt: number;
}

interface Provider {
  id: string;
  name: string;
  url: string;
  check: () => Promise<ServiceCheck>;
}

const UA = 'gsoc-monitor service-status';
const MAX_INCIDENTS = 5;
const OK: ServiceCheck = { level: 'ok', summary: 'Operational', incidents: [] };

const RANK: Record<ServiceLevel, number> = { ok: 0, unknown: 1, minor: 2, major: 3 };
export const worstLevel = (levels: ServiceLevel[]): ServiceLevel =>
  levels.reduce<ServiceLevel>((w, l) => (RANK[l] > RANK[w] ? l : w), 'ok');

const clip = (s: string, n = 180) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function fromIncidents(incidents: ServiceIncident[], okSummary = 'Operational'): ServiceCheck {
  if (incidents.length === 0) return { ...OK, summary: okSummary };
  const sorted = [...incidents].sort((a, b) => RANK[b.level] - RANK[a.level]);
  const level = worstLevel(sorted.map((i) => i.level));
  const more = sorted.length > 1 ? ` (+${sorted.length - 1} more)` : '';
  return { level, summary: `${sorted[0].title}${more}`, incidents: sorted.slice(0, MAX_INCIDENTS) };
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json, text/xml, */*' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res;
}
const getJson = async (url: string): Promise<unknown> => (await get(url)).json();

// --- Atlassian Statuspage ---------------------------------------------------

const impactLevel = (impact: unknown): ServiceLevel =>
  impact === 'major' || impact === 'critical' ? 'major' : impact === 'minor' ? 'minor' : 'ok';

/** `/api/v2/status.json`: the page-wide indicator. Maintenance is not an outage. */
export function parseStatuspageStatus(body: unknown): { level: ServiceLevel; description: string } {
  const status = (body as { status?: { indicator?: unknown; description?: unknown } })?.status;
  if (!status || typeof status.indicator !== 'string') throw new Error('not a Statuspage status body');
  return {
    level: impactLevel(status.indicator),
    description: typeof status.description === 'string' ? status.description : 'Operational',
  };
}

/** `/api/v2/incidents/unresolved.json`. */
export function parseStatuspageIncidents(body: unknown): ServiceIncident[] {
  const list = (body as { incidents?: unknown })?.incidents;
  if (!Array.isArray(list)) return [];
  return list.map((i) => ({
    title: clip(String(i?.name ?? 'Incident')),
    // An incident with impact "none" is still an open incident: show it amber.
    level: impactLevel(i?.impact) === 'major' ? 'major' : 'minor',
    url: typeof i?.shortlink === 'string' ? i.shortlink : undefined,
    since: typeof i?.started_at === 'string' ? i.started_at : i?.created_at,
  }));
}

function statuspage(id: string, name: string, host: string): Provider {
  const base = `https://${host}`;
  return {
    id,
    name,
    url: base,
    check: async () => {
      const { level, description } = parseStatuspageStatus(await getJson(`${base}/api/v2/status.json`));
      // The incident list is only worth a second request when something is up.
      if (level === 'ok') return { level, summary: description, incidents: [] };
      const incidents = await getJson(`${base}/api/v2/incidents/unresolved.json`)
        .then(parseStatuspageIncidents)
        .catch(() => []);
      // The page indicator is the provider's own roll-up; incidents only add detail.
      return {
        level,
        summary: incidents[0]?.title ?? description,
        incidents: incidents.slice(0, MAX_INCIDENTS),
      };
    },
  };
}

// --- Microsoft --------------------------------------------------------------

const msLevel = (status: unknown): ServiceLevel => {
  const s = String(status ?? '').toLowerCase();
  if (!s || s.includes('operational') || s.includes('restored') || s.includes('false positive')) return 'ok';
  return s.includes('interruption') || s.includes('outage') ? 'major' : 'minor';
};

/**
 * status.cloud.microsoft, which needs no sign-in: `mac` is the one post
 * Microsoft publishes when a business-tenant incident is wide enough to
 * announce publicly; `consumer` lists the consumer services. Tenant-specific
 * advisories only exist in the admin center and are not visible here.
 */
export function parseMicrosoft365(mac: unknown, consumer: unknown): ServiceCheck {
  const incidents: ServiceIncident[] = [];
  const post = mac as { Title?: unknown; Status?: unknown; AuthoredDateTime?: unknown } | null;
  if (post && typeof post.Title === 'string' && post.Title.trim() && msLevel(post.Status) !== 'ok') {
    incidents.push({
      title: clip(post.Title),
      level: msLevel(post.Status),
      url: 'https://status.cloud.microsoft',
      since: typeof post.AuthoredDateTime === 'string' ? post.AuthoredDateTime : undefined,
    });
  }
  if (Array.isArray(consumer)) {
    for (const s of consumer) {
      const level = msLevel(s?.Status);
      if (level === 'ok') continue;
      const name = String(s?.ServiceDisplayName ?? 'Microsoft 365');
      const title = typeof s?.Title === 'string' && s.Title.trim() ? s.Title : String(s?.Status);
      incidents.push({ title: clip(`${name}: ${title}`), level, url: 'https://status.cloud.microsoft' });
    }
  }
  return fromIncidents(incidents);
}

const xmlText = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** The Azure status RSS feed carries one item per active incident, and none when healthy. */
export function parseAzureRss(xml: string): ServiceCheck {
  if (!/<rss[\s>]/.test(xml)) throw new Error('not an RSS body');
  const incidents: ServiceIncident[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (t: string) => m[1].match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1];
    const date = tag('pubDate');
    const since = date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : undefined;
    incidents.push({
      title: clip(xmlText(tag('title') ?? 'Azure incident')),
      level: 'minor',
      url: tag('link')?.trim() || 'https://azure.status.microsoft/en-us/status',
      since,
    });
  }
  return fromIncidents(incidents);
}

// --- AWS --------------------------------------------------------------------

/**
 * AWS Health public events. A regional event only raises the level when it is
 * global or in a US region — a long outage in a region the business does not
 * use would otherwise hold the chip red for weeks. Others are still listed.
 */
export function parseAwsEvents(body: unknown): ServiceCheck {
  if (!Array.isArray(body)) throw new Error('not an AWS events body');
  const incidents: ServiceIncident[] = [];
  for (const e of body) {
    if (e?.end_time) continue;
    const region = String(e?.arn ?? '').split(':')[3] ?? '';
    const counts = region === '' || region === 'global' || region.startsWith('us-');
    const code = String(e?.status);
    const level: ServiceLevel = !counts ? 'ok' : code === '3' ? 'major' : 'minor';
    const where = e?.region_name ? ` (${e.region_name})` : '';
    const seconds = Number(e?.date);
    incidents.push({
      title: clip(`${e?.service_name ?? 'AWS'}: ${e?.summary ?? 'Service event'}${where}`),
      level,
      url: 'https://health.aws.amazon.com/health/status',
      since: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined,
    });
  }
  const check = fromIncidents(incidents);
  if (check.level === 'ok' && incidents.length > 0) {
    check.summary = `US regions operational · ${incidents.length} event${incidents.length === 1 ? '' : 's'} elsewhere`;
  }
  return check;
}

// --- Google -----------------------------------------------------------------

/** Google Cloud and Workspace share one incidents.json shape; no `end` means active. */
export function parseGoogleIncidents(body: unknown, base: string): ServiceCheck {
  if (!Array.isArray(body)) throw new Error('not a Google incidents body');
  const incidents: ServiceIncident[] = [];
  for (const i of body) {
    if (i?.end) continue;
    const impact = String(i?.status_impact ?? '');
    const level: ServiceLevel =
      impact === 'SERVICE_OUTAGE' ? 'major' : impact === 'SERVICE_INFORMATION' ? 'ok' : 'minor';
    // Workspace descriptions are multi-paragraph markdown: keep the summary line.
    const desc = String(i?.external_desc ?? 'Incident')
      .replace(/\*\*Summary:\*\*/i, '')
      .trim()
      .split('\n')[0]
      .replace(/\*\*/g, '');
    incidents.push({
      title: clip(`${i?.service_name ?? 'Google'}: ${desc}`),
      level,
      url: typeof i?.uri === 'string' ? `${base}/${i.uri}` : base,
      since: typeof i?.begin === 'string' ? i.begin : undefined,
    });
  }
  return fromIncidents(incidents);
}

// --- Slack, Salesforce ------------------------------------------------------

export function parseSlack(body: unknown): ServiceCheck {
  const list = (body as { active_incidents?: unknown })?.active_incidents;
  if (!Array.isArray(list)) throw new Error('not a Slack status body');
  return fromIncidents(
    list.map((i) => ({
      title: clip(String(i?.title ?? 'Incident')),
      level: i?.type === 'outage' ? 'major' : i?.type === 'notice' ? 'ok' : 'minor',
      url: typeof i?.url === 'string' ? i.url : undefined,
      since: typeof i?.date_created === 'string' ? i.date_created : undefined,
    }))
  );
}

/** Salesforce runs hundreds of instances; only a core or all-instance disruption is "major". */
export function parseSalesforce(body: unknown): ServiceCheck {
  if (!Array.isArray(body)) throw new Error('not a Salesforce incidents body');
  return fromIncidents(
    body.map((i) => {
      const type = String(i?.type ?? 'Incident');
      const wide = Boolean(i?.affectsAll) || Boolean(i?.isCore);
      const services = Array.isArray(i?.serviceKeys) ? i.serviceKeys.join(', ') : '';
      const n = Array.isArray(i?.instanceKeys) ? i.instanceKeys.length : 0;
      return {
        title: clip(`${type}${services ? `: ${services}` : ''}${n ? ` (${n} instance${n === 1 ? '' : 's'})` : ''}`),
        level: wide && /disruption/i.test(type) ? 'major' : 'minor',
        url: `https://status.salesforce.com/incidents/${i?.id ?? ''}`,
        since: typeof i?.createdAt === 'string' ? i.createdAt : undefined,
      } satisfies ServiceIncident;
    })
  );
}

// --- Catalog ----------------------------------------------------------------

const GCP = 'https://status.cloud.google.com';
const GWS = 'https://www.google.com/appsstatus/dashboard';

export const PROVIDERS: Provider[] = [
  {
    id: 'm365',
    name: 'Microsoft 365',
    url: 'https://status.cloud.microsoft',
    check: async () => {
      // Either half alone is still an answer; both failing is an error.
      const [mac, consumer] = await Promise.allSettled([
        getJson('https://status.cloud.microsoft/api/posts/mac'),
        getJson('https://status.cloud.microsoft/api/posts/m365Consumer'),
      ]);
      if (mac.status === 'rejected' && consumer.status === 'rejected') throw mac.reason;
      return parseMicrosoft365(
        mac.status === 'fulfilled' ? mac.value : null,
        consumer.status === 'fulfilled' ? consumer.value : null
      );
    },
  },
  {
    id: 'azure',
    name: 'Azure',
    url: 'https://azure.status.microsoft/en-us/status',
    check: async () =>
      parseAzureRss(await (await get('https://azure.status.microsoft/en-us/status/feed/')).text()),
  },
  {
    id: 'aws',
    name: 'AWS',
    url: 'https://health.aws.amazon.com/health/status',
    check: async () => {
      // Served as UTF-16 with a byte-order mark, which Response.json() rejects.
      const buf = await (await get('https://health.aws.amazon.com/public/currentevents')).arrayBuffer();
      const b = new Uint8Array(buf);
      const enc = b[0] === 0xfe && b[1] === 0xff ? 'utf-16be' : b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : 'utf-8';
      return parseAwsEvents(JSON.parse(new TextDecoder(enc).decode(buf).replace(/^﻿/, '')));
    },
  },
  {
    id: 'gcp',
    name: 'Google Cloud',
    url: GCP,
    check: async () => parseGoogleIncidents(await getJson(`${GCP}/incidents.json`), GCP),
  },
  {
    id: 'gworkspace',
    name: 'Google Workspace',
    url: GWS,
    check: async () => parseGoogleIncidents(await getJson(`${GWS}/incidents.json`), GWS),
  },
  statuspage('cloudflare', 'Cloudflare', 'www.cloudflarestatus.com'),
  statuspage('akamai', 'Akamai', 'www.akamaistatus.com'),
  statuspage('zoom', 'Zoom', 'www.zoomstatus.com'),
  {
    id: 'slack',
    name: 'Slack',
    url: 'https://slack-status.com',
    check: async () => parseSlack(await getJson('https://slack-status.com/api/v2.0.0/current')),
  },
  statuspage('smartsheet', 'Smartsheet', 'status.smartsheet.com'),
  statuspage('shopify', 'Shopify', 'www.shopifystatus.com'),
  statuspage('square', 'Square', 'www.issquareup.com'),
  statuspage('toast', 'Toast POS', 'status.toasttab.com'),
  statuspage('mews', 'Mews', 'status.mews.com'),
  statuspage('quickbooks', 'QuickBooks', 'status.quickbooks.intuit.com'),
  {
    id: 'salesforce',
    name: 'Salesforce',
    url: 'https://status.salesforce.com',
    check: async () => parseSalesforce(await getJson('https://api.status.salesforce.com/v1/incidents/active')),
  },
  statuspage('hubspot', 'HubSpot', 'status.hubspot.com'),
  statuspage('twilio', 'Twilio / SendGrid', 'status.twilio.com'),
  statuspage('duo', 'Duo', 'status.duo.com'),
  statuspage('verkada', 'Verkada', 'status.verkada.com'),
  statuspage('genetec', 'Genetec', 'status.genetec.com'),
  statuspage('dropbox', 'Dropbox', 'status.dropbox.com'),
  statuspage('box', 'Box', 'status.box.com'),
  statuspage('atlassian', 'Atlassian', 'status.atlassian.com'),
  statuspage('asana', 'Asana', 'status.asana.com'),
  statuspage('github', 'GitHub', 'www.githubstatus.com'),
  statuspage('openai', 'OpenAI', 'status.openai.com'),
  statuspage('claude', 'Claude', 'status.claude.com'),
  statuspage('figma', 'Figma', 'status.figma.com'),
  statuspage('vimeo', 'Vimeo', 'www.vimeostatus.com'),
  statuspage('discord', 'Discord', 'discordstatus.com'),
  statuspage('reddit', 'Reddit', 'www.redditstatus.com'),
  statuspage('digitalocean', 'DigitalOcean', 'status.digitalocean.com'),
];

// A status page that fails once keeps its last answer for this long before the
// service flips to "unknown" — one timeout should not blank a healthy dot.
const KEEP_LAST_GOOD_MS = 15 * 60_000;
const lastGood = new Map<string, ServiceStatus>();

export async function checkAllServices(providers: Provider[] = PROVIDERS): Promise<ServiceStatus[]> {
  const now = Date.now();
  const results = await Promise.allSettled(providers.map((p) => p.check()));
  return providers.map((p, i) => {
    const r = results[i];
    const base = { id: p.id, name: p.name, url: p.url };
    if (r.status === 'fulfilled') {
      const status: ServiceStatus = { ...base, ...r.value, checkedAt: now };
      lastGood.set(p.id, status);
      return status;
    }
    const prev = lastGood.get(p.id);
    if (prev && now - prev.checkedAt < KEEP_LAST_GOOD_MS) return prev;
    return { ...base, level: 'unknown', summary: 'Status page unreachable', incidents: [], checkedAt: now };
  });
}
