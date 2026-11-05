import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { flyToBoundingBox, flyToLonLat } from '../cesium/flyTo';
import { alertRings, fetchActiveAlertsShared, loadCountyAtlas, type RawAlert } from '../layers/alerts/alertsData';
import { alertPanelData } from '../layers/alerts/alertPanel';
import { WEA_CLASSES } from '../layers/warn/warnMeta';
import { api } from '../api/client';
import { startVisiblePolling } from '../lib/poll';
import { usePanelStore } from '../panels/panelStore';
import { useScreensaverStore } from '../screensaver/screensaverStore';
import { useLayersStore } from '../store/layersStore';
import { useCrisisStore } from '../crisis/crisisStore';
import { useCrisisDockStore } from '../ui/uiStore';
import { fetchNpsFeedShared } from '../nps/npsStore';
import { NPS_CATEGORY, formatNpsDay, relativeNpsDay } from '../nps/npsMeta';
import { parkFrame } from '../nps/flyToPark';
import { openNpsPanel } from '../nps/openNpsPanel';
import type { EarthquakeFeature, LayerId } from '../types';
import { useAlertNotifyStore } from './alertNotifyStore';
import type { AlertChange } from './alertChanges';
import {
  NOTIFY_RADIUS_MI, detectNewAlertNotices, nwsAlertId, nwsCancelNotice, vanishedEarly, type PinHit, type SeenMap,
} from './pinAlertMatch';
import {
  QUAKE_NOTIFY_RADIUS_MI, WARN_NOTIFY_RADIUS_MI,
  detectFlightNotices, detectNpsNotices, detectQuakeNotices, detectShipNotices, detectWarnNotices,
  type NpsSeen, type SeenIds,
} from './detectors';
import { isEndedNotice, type Notice, type NoticeCategory, type NwsNotice, type WarnNotice } from './notices';

// ── Alert popups ─────────────────────────────────────────────────────────────
// While notifications are on, each enabled source is polled on its own clock;
// whatever it reports as new flashes the screen and queues a card in the
// middle of it until someone acknowledges it. Sources:
//   nws    — NWS alerts within 15 mi of a property (shares the map layer's download):
//            new ones, changes to them there, and cancellations
//   warn   — Wireless Emergency Alerts (PBS WARN) within 50 mi, and their updates
//   quake  — M4.5+ earthquakes within 50 mi
//   nps    — new or changed National Park Service alerts at the followed parks
//   flight — the company aircraft's takeoffs and landings
//   ship   — Windstar arrivals at and departures from port
// Runs whether or not the matching map layers are shown, and during the
// screensaver (the wall-display case).

/**
 * One source's poll step. Built fresh each time the source is switched on, so
 * its memory of what it has seen — and the first poll's baseline — starts over.
 */
type Step = (baseline: boolean) => Promise<Notice[]>;

/** Alerts that left the feed early, looked up a few per poll, each tried a few times. */
const FATE_LOOKUPS_PER_POLL = 4;
const FATE_TRIES = 3;

const nwsStep = (): Step => {
  let seen: SeenMap = new Map();
  // The last poll's alerts that reached a pin, to catch one that leaves the
  // feed before its end; and those waiting for NWS to say why they left.
  let near: RawAlert[] = [];
  const leftEarly = new Map<string, { alert: RawAlert; tries: number }>();
  return async (baseline) => {
    // Without the county outlines most alerts have no area to measure, and
    // recording them as "seen, nowhere near" would swallow them for good — so
    // a poll that can't load counties is skipped, not half-done.
    const [alerts, atlas] = await Promise.all([fetchActiveAlertsShared(), loadCountyAtlas()]);
    const now = Date.now();
    const ringsOf = (a: RawAlert) => alertRings(a, atlas.geometries);
    const out = detectNewAlertNotices({ alerts, ringsOf, seen, baseline, now });
    seen = out.seen;
    if (!baseline) {
      for (const a of vanishedEarly(near, alerts, now)) leftEarly.set(nwsAlertId(a) ?? '', { alert: a, tries: 0 });
    }
    near = alerts.filter((a) => (seen.get(nwsAlertId(a) ?? '')?.pins.length ?? 0) > 0);
    return [...out.notices, ...(await cancellations(leftEarly, ringsOf))];
  };
};

/**
 * Asks NWS what became of alerts that left the feed before their end, and
 * turns the cancelled ones into notices. A replaced one is told by its new
 * version; one nothing replaced was a feed blip.
 */
async function cancellations(
  leftEarly: Map<string, { alert: RawAlert; tries: number }>,
  ringsOf: (a: RawAlert) => number[][][]
): Promise<Notice[]> {
  const notices: Notice[] = [];
  for (const [id, entry] of [...leftEarly].slice(0, FATE_LOOKUPS_PER_POLL)) {
    try {
      const fate = await api.alertFate(id);
      leftEarly.delete(id);
      if (fate.status !== 'cancelled') continue;
      const notice = nwsCancelNotice({ alert: entry.alert, cancel: fate.by, rings: ringsOf(entry.alert) });
      if (notice) notices.push(notice);
    } catch (err) {
      if (++entry.tries >= FATE_TRIES) leftEarly.delete(id);
      console.warn('[alert-notify] cancellation check failed:', err instanceof Error ? err.message : err);
    }
  }
  return notices;
}

const warnStep = (): Step => {
  let seen: SeenMap = new Map();
  return async (baseline) => {
    const feed = await api.warn();
    const out = detectWarnNotices({ alerts: feed.alerts, seen, baseline, now: Date.now() });
    seen = out.seen;
    return out.notices;
  };
};

const quakeStep = (): Step => {
  let seen: SeenMap = new Map();
  return async (baseline) => {
    const fc = await api.earthquakes('4.5', 'day');
    const out = detectQuakeNotices({
      features: (fc.features ?? []) as unknown as EarthquakeFeature[],
      seen,
      baseline,
      now: Date.now(),
    });
    seen = out.seen;
    return out.notices;
  };
};

const npsStep = (): Step => {
  let seen: NpsSeen = new Map();
  return async (baseline) => {
    const feed = await fetchNpsFeedShared();
    // A failed alerts half is a skipped poll, never "no alerts": the alerts it
    // hid would all read as new once it recovered.
    if (!feed.alerts) throw new Error(feed.alertsError ?? 'NPS alerts unavailable');
    const out = detectNpsNotices({ alerts: feed.alerts, seen, baseline, now: Date.now() });
    seen = out.seen;
    return out.notices;
  };
};

const flightStep = (): Step => {
  let seen: SeenIds = new Map();
  return async (baseline) => {
    const { events } = await api.flightEvents();
    const out = detectFlightNotices({ events, seen, baseline, now: Date.now() });
    seen = out.seen;
    return out.notices;
  };
};

const shipStep = (): Step => {
  let seen: SeenIds = new Map();
  return async (baseline) => {
    const { events } = await api.shipEvents();
    const out = detectShipNotices({ events, seen, baseline, now: Date.now() });
    seen = out.seen;
    return out.notices;
  };
};

const SOURCES: Record<NoticeCategory, { makeStep: () => Step; everyMs: number }> = {
  nws: { makeStep: nwsStep, everyMs: 60_000 },
  warn: { makeStep: warnStep, everyMs: 60_000 },
  quake: { makeStep: quakeStep, everyMs: 60_000 },
  // The server refreshes NPS alerts every 5 minutes; parks post a few a week.
  nps: { makeStep: npsStep, everyMs: 120_000 },
  flight: { makeStep: flightStep, everyMs: 60_000 },
  // Positions land about every two hours; every two minutes is plenty.
  ship: { makeStep: shipStep, everyMs: 120_000 },
};

function useNoticeSource(category: NoticeCategory, on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const { makeStep, everyMs } = SOURCES[category];
    const step = makeStep();
    let baselined = false;
    let cancelled = false;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const notices = await step(!baselined);
        if (cancelled) return;
        baselined = true;
        if (notices.length > 0) useAlertNotifyStore.getState().push(notices);
      } catch (err) {
        console.warn(`[alert-notify] ${category} poll skipped:`, err instanceof Error ? err.message : err);
      } finally {
        busy = false;
      }
    };
    const stop = startVisiblePolling(() => void tick(), everyMs);
    return () => {
      cancelled = true;
      stop();
    };
  }, [category, on]);
}

// ── Card ──────────────────────────────────────────────────────────────────────

function fmtTime(iso: string | number | null | undefined): string | null {
  if (iso === null || iso === undefined || iso === '') return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString([], {
    ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtUntil(iso: string | null | undefined, now: number): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return null;
  const mins = Math.round((t - now) / 60_000);
  if (mins <= 0) return 'expired';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  return mins % 60 ? `in ${h} h ${mins % 60} min` : `in ${h} h`;
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

/** "Spain" for "ES". */
function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "Englewood, CO" in the US and Canada; "Nice, France" elsewhere. */
function airportPlace(a: { municipality: string | null; region: string; country: string }): string | null {
  const where = a.country === 'US' || a.country === 'CA' ? a.region : countryName(a.country);
  return [a.municipality, where].filter(Boolean).join(', ') || null;
}

function headerText(n: Notice): string {
  switch (n.category) {
    case 'nws':
      if (n.cancelled) return 'NWS alert cancelled near your locations';
      if (isEndedNotice(n)) return 'NWS alert no longer in effect at some of your locations';
      return n.isUpdate ? 'NWS alert changed near your locations' : 'New NWS alert near your locations';
    case 'warn':
      if (isEndedNotice(n)) return 'Emergency alert no longer covers some of your locations';
      return n.isUpdate ? 'Emergency alert updated near your locations' : 'Emergency alert sent to phones near your locations';
    case 'quake':
      return 'Earthquake near your locations';
    case 'nps':
      return n.isUpdate
        ? `National Park Service alert updated · ${n.alert.park}`
        : `New National Park Service alert · ${n.alert.park}`;
    case 'flight':
      return n.event.kind === 'takeoff' ? 'Company aircraft departed' : 'Company aircraft landed';
    case 'ship':
      return n.event.kind === 'arrival' ? 'Windstar ship arrived in port' : 'Windstar ship left port';
  }
}

const MAX_PINS_LISTED = 6;

function PinList({ hits, radiusMi, color, heading, fresh = [] }: {
  hits: PinHit[];
  radiusMi: number;
  color: string;
  heading?: string;
  /** Keys of pins to mark as newly reached. */
  fresh?: readonly string[];
}) {
  const listed = hits.slice(0, MAX_PINS_LISTED);
  const more = hits.length - listed.length;
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">{heading ?? `Within ${radiusMi} mi`}</div>
      <ul className="space-y-0.5">
        {listed.map(({ pin, distanceMi }) => (
          <li key={pin.key} className="flex items-baseline gap-2 text-[12.5px]">
            <span aria-hidden className="text-white/40">📍</span>
            <span className="min-w-0 flex-1 truncate text-white/90">
              {pin.name} <span className="text-white/35">· {pin.groupName}</span>
              {fresh.includes(pin.key) && (
                <span className="ml-1.5 rounded px-1 py-px text-[9.5px] font-bold uppercase tracking-wider" style={{ color, background: `${color}22` }}>
                  New
                </span>
              )}
            </span>
            <span
              className={`shrink-0 text-[11px] font-semibold ${distanceMi === 0 ? '' : 'text-white/60'}`}
              style={distanceMi === 0 ? { color } : undefined}
            >
              {distanceMi === 0 ? 'Inside alert area' : `${distanceMi.toFixed(1)} mi away`}
            </span>
          </li>
        ))}
      </ul>
      {more > 0 && <div className="mt-1 text-[11px] text-white/45">+{more} more location{more === 1 ? '' : 's'}</div>}
    </div>
  );
}

function Chips({ items }: { items: (string | null | undefined | false)[] }) {
  const shown = items.filter((x): x is string => !!x);
  if (shown.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
      {shown.map((c, i) => (
        <span key={`${c}-${i}`} className="rounded bg-white/10 px-1.5 py-0.5 text-white/75">{c}</span>
      ))}
    </div>
  );
}

function Title({ color, children }: { color: string; children: ReactNode }) {
  return (
    <h2 id="alert-notice-title" className="text-[22px] font-bold leading-tight" style={{ color }}>
      {children}
    </h2>
  );
}

function Times({ items }: { items: [string, string | null][] }) {
  const shown = items.filter(([, v]) => v);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-white/55">
      {shown.map(([label, value]) => (
        <span key={label}><span className="text-white/35">{label}</span> {value}</span>
      ))}
    </div>
  );
}

/** How a change's old or new value reads: times as times, an unset one by what it means. */
function changeValue(c: AlertChange, v: string | null): string {
  if (v === null) return c.label === 'Ends' ? 'until further notice' : 'not given';
  if (c.kind === 'time') return fmtTime(v) ?? v;
  // CAP's recommended actions are run together: "AllClear" → "All clear".
  return c.label === 'Action' ? v.replace(/([a-z])([A-Z])/g, (_, a: string, b: string) => `${a} ${b.toLowerCase()}`) : v;
}

/** What an update changed from the version it replaces, and where it now reaches or no longer does. */
function WhatChanged({ n }: { n: NwsNotice | WarnNotice }) {
  const rows: { label: string; body: ReactNode }[] = n.changes.map((c) => ({
    label: c.label,
    body:
      // The new message itself is shown in full above.
      c.label === 'Message' ? (
        <span className="text-white/60">Previously: “{c.from ?? 'none'}”</span>
      ) : (
        <>
          <span className="text-white/45 line-through decoration-white/30">{changeValue(c, c.from)}</span>
          <span className="px-1.5 text-white/35">→</span>
          <span className="font-semibold" style={{ color: n.color }}>{changeValue(c, c.to)}</span>
        </>
      ),
  }));
  const reached = n.hits.filter((h) => n.newPins.includes(h.pin.key)).map((h) => h.pin.name);
  if (reached.length > 0) rows.push({ label: 'Now reaches', body: reached.join(', ') });
  if (n.endedAt.length > 0) rows.push({ label: 'No longer in effect at', body: n.endedAt.map((p) => p.name).join(', ') });
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: `${n.color}55`, background: `${n.color}14` }}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: n.color }}>What changed</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px] leading-snug">
        {rows.map((r, i) => (
          <Fragment key={i}>
            <dt className="whitespace-nowrap text-white/45">{r.label}</dt>
            <dd className="min-w-0 text-white/90">{r.body}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

function NoticeBody({ n, now }: { n: Notice; now: number }) {
  switch (n.category) {
    case 'nws': {
      const p = n.alert.properties;
      if (n.cancelled) {
        return (
          <>
            <div>
              <Title color={n.color}>{p.event ?? 'NWS Alert'} cancelled</Title>
              <Chips items={[p.senderName]} />
              <p className="mt-2 text-[12.5px] leading-snug text-white/80">
                {n.cancelled.text ?? 'The National Weather Service cancelled this alert. It is no longer in effect.'}
              </p>
            </div>
            <PinList hits={n.hits} radiusMi={NOTIFY_RADIUS_MI} color={n.color} heading={`Was in effect within ${NOTIFY_RADIUS_MI} mi`} />
            <Times items={[['Cancelled', fmtTime(n.cancelled.sent)], ['Was due to end', fmtTime(p.ends ?? p.expires)]]} />
            {p.areaDesc && <p className="line-clamp-2 text-[11px] leading-snug text-white/40">{p.areaDesc}</p>}
          </>
        );
      }
      // The hazard's own end; `expires` (when this message lapses) only where NWS gives no end.
      const end = p.ends ?? p.expires;
      const starts = p.onset && Date.parse(p.onset) > now ? fmtTime(p.onset) : null;
      return (
        <>
          <div>
            <Title color={n.color}>{p.event ?? 'NWS Alert'}</Title>
            <Chips items={[p.severity, p.urgency, p.senderName]} />
            {p.headline && <p className="mt-2 text-[12.5px] leading-snug text-white/80">{p.headline}</p>}
          </div>
          {n.isUpdate && <WhatChanged n={n} />}
          {n.hits.length > 0 && (
            <PinList
              hits={n.hits}
              radiusMi={NOTIFY_RADIUS_MI}
              color={n.color}
              fresh={n.isUpdate ? n.newPins : []}
              heading={isEndedNotice(n) ? `Still within ${NOTIFY_RADIUS_MI} mi` : undefined}
            />
          )}
          <Times
            items={[
              ['Issued', fmtTime(p.sent ?? p.effective)],
              ['Starts', starts],
              [p.ends ? 'Ends' : 'Expires', fmtTime(end) && `${fmtTime(end)}${fmtUntil(end, now) ? ` (${fmtUntil(end, now)})` : ''}`],
            ]}
          />
          {p.areaDesc && <p className="line-clamp-2 text-[11px] leading-snug text-white/40">{p.areaDesc}</p>}
        </>
      );
    }
    case 'warn': {
      const a = n.alert;
      const cls = WEA_CLASSES[a.weaClass] ?? WEA_CLASSES['public-safety'];
      return (
        <>
          <div>
            <Title color={n.color}>{a.event}</Title>
            <Chips items={[cls.label, a.severity, a.sender]} />
          </div>
          {a.weaText && (
            <div className="rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2">
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">Sent to phones</div>
              <p className="text-[13px] font-medium leading-snug text-white/90">{a.weaText}</p>
            </div>
          )}
          {n.isUpdate && <WhatChanged n={n} />}
          {n.hits.length > 0 && (
            <PinList
              hits={n.hits}
              radiusMi={WARN_NOTIFY_RADIUS_MI}
              color={n.color}
              fresh={n.isUpdate ? n.newPins : []}
              heading={isEndedNotice(n) ? `Still within ${WARN_NOTIFY_RADIUS_MI} mi` : undefined}
            />
          )}
          <Times
            items={[
              ['Sent', fmtTime(a.sent)],
              ['Expires', fmtTime(a.expires) && `${fmtTime(a.expires)}${fmtUntil(a.expires, now) ? ` (${fmtUntil(a.expires, now)})` : ''}`],
            ]}
          />
        </>
      );
    }
    case 'quake': {
      const q = n.quake;
      return (
        <>
          <div>
            <Title color={n.color}>M{q.mag.toFixed(1)} earthquake</Title>
            <Chips
              items={[
                q.depthKm !== null ? `${q.depthKm.toFixed(0)} km deep` : null,
                q.tsunami === 1 && 'Tsunami flag',
                q.status === 'reviewed' ? 'Reviewed' : q.status === 'automatic' ? 'Automatic' : null,
              ]}
            />
            {q.place && <p className="mt-2 text-[12.5px] leading-snug text-white/80">{q.place}</p>}
          </div>
          <PinList hits={n.hits} radiusMi={QUAKE_NOTIFY_RADIUS_MI} color={n.color} />
          <Times items={[['Occurred', fmtTime(q.time)], ['Felt reports', q.felt ? String(q.felt) : null]]} />
        </>
      );
    }
    case 'nps': {
      const a = n.alert;
      const cat = NPS_CATEGORY[a.category] ?? NPS_CATEGORY.info;
      const posted = formatNpsDay(a.postedDay);
      const ago = relativeNpsDay(a.postedDay);
      return (
        <>
          <div>
            <Title color={n.color}>{a.title}</Title>
            <Chips items={[cat.label, a.parkFullName, n.isUpdate && 'Updated']} />
          </div>
          {a.description && (
            <div className="hud-scroll max-h-56 overflow-y-auto overscroll-contain rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
              <p className="whitespace-pre-line text-[12.5px] leading-snug text-white/85">{a.description}</p>
            </div>
          )}
          <Times items={[[n.isUpdate ? 'Last edited' : 'Posted', posted && `${posted}${ago ? ` (${ago})` : ''}`]]} />
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
            {a.url && (
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-emerald-300/85 hover:text-emerald-200 hover:underline">
                More info on nps.gov ↗
              </a>
            )}
            <a href={a.conditionsUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-300/85 hover:text-emerald-200 hover:underline">
              Park conditions ↗
            </a>
          </div>
        </>
      );
    }
    case 'flight': {
      const e = n.event;
      const a = e.airport;
      const verb = e.kind === 'takeoff' ? 'took off from' : 'landed at';
      const where = a ? `${a.name} (${a.iata ?? a.ident})` : `${Math.abs(e.lat).toFixed(3)}°${e.lat >= 0 ? 'N' : 'S'} ${Math.abs(e.lon).toFixed(3)}°${e.lon >= 0 ? 'E' : 'W'}`;
      const city = a ? airportPlace(a) : null;
      return (
        <>
          <div>
            <Title color={n.color}>
              {e.reg} {verb} {where}
            </Title>
            <Chips items={[e.model, a ? a.ident : 'No listed airport nearby']} />
            {city && <p className="mt-2 text-[12.5px] leading-snug text-white/80">{city}</p>}
          </div>
          <Times
            items={[
              [e.kind === 'takeoff' ? 'Wheels up' : 'Touched down', fmtTime(e.t)],
              ['From the field', a && a.distanceKm >= 2 ? `${a.distanceKm.toFixed(1)} km` : null],
            ]}
          />
        </>
      );
    }
    case 'ship': {
      const e = n.event;
      const country = e.port ? countryName(e.port.country) : null;
      const port = e.port ? `${e.port.name}${country ? `, ${country}` : ''}` : 'an unlisted port';
      const lateBy = e.detectedAt - e.t;
      return (
        <>
          <div>
            <Title color={n.color}>
              {e.name} {e.kind === 'arrival' ? 'arrived at' : 'departed'} {port}
            </Title>
            <Chips items={['Windstar', e.kind === 'departure' && e.destination ? `Bound for ${e.destination}` : null]} />
          </div>
          <Times
            items={[
              [e.kind === 'arrival' ? 'In port by' : 'Under way by', fmtTime(e.t)],
              ['Reported', lateBy > 10 * 60_000 ? fmtTime(e.detectedAt) : null],
            ]}
          />
          <p className="text-[10.5px] leading-snug text-white/35">
            Ship positions update about every two hours, so this can trail the ship by that much.
          </p>
        </>
      );
    }
  }
}

export function NoticeCard({ notice, index, total, now, onShow, onDismiss, onDismissAll, onTurnOff }: {
  notice: Notice;
  index: number;
  total: number;
  now: number;
  onShow: () => void;
  onDismiss: () => void;
  onDismissAll: () => void;
  onTurnOff: () => void;
}) {
  const color = notice.color;
  return (
    <div
      role="alert"
      aria-labelledby="alert-notice-title"
      className="gsoc-notice-pop pointer-events-auto w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-ink-900/95 text-white shadow-2xl backdrop-blur-md"
      style={{ borderColor: `${color}aa`, boxShadow: `0 0 0 1px ${color}55, 0 0 48px ${color}55, 0 24px 64px rgba(0,0,0,0.7)` }}
    >
      <div className="flex items-center gap-2 px-4 py-2" style={{ background: `${color}33`, borderBottom: `1px solid ${color}66` }}>
        <span aria-hidden className="text-[15px]">
          {notice.category === 'flight'
            ? '✈'
            : notice.category === 'ship'
              ? '⚓'
              : notice.category === 'nps'
                ? '🏞'
                : (notice.category === 'nws' || notice.category === 'warn') && isEndedNotice(notice)
                  ? '✓'
                  : '⚠'}
        </span>
        <span className="flex-1 text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color }}>
          {headerText(notice)}
        </span>
        {total > 1 && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/70">
            {index + 1} of {total}
          </span>
        )}
      </div>

      <div className="space-y-3 px-4 py-3.5">
        <NoticeBody n={notice} now={now} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-white/8 px-4 py-2.5">
        <button
          onClick={onTurnOff}
          className="mr-auto text-[10.5px] text-white/35 underline-offset-2 transition hover:text-white/70 hover:underline"
        >
          Turn off notifications
        </button>
        {total > 1 && (
          <button
            onClick={onDismissAll}
            className="rounded-md border border-white/10 px-3 py-1.5 text-[12px] text-white/60 transition hover:bg-white/8 hover:text-white"
          >
            Dismiss all
          </button>
        )}
        <button
          onClick={onDismiss}
          className="rounded-md border border-white/15 px-3 py-1.5 text-[12px] font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          {total > 1 ? 'Next' : 'Dismiss'}
        </button>
        <button
          onClick={onShow}
          className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-ink-950 transition hover:brightness-110"
          style={{ background: color }}
        >
          Show on map
        </button>
      </div>
    </div>
  );
}

// ── Show on map ───────────────────────────────────────────────────────────────

function ensureLayer(id: LayerId): void {
  const layers = useLayersStore.getState();
  if (!layers.active[id]) layers.toggleLayer(id);
}

function padded([w, s, e, n]: [number, number, number, number]): [number, number, number, number] {
  const padLon = Math.max((e - w) * 0.25, 0.25);
  const padLat = Math.max((n - s) * 0.25, 0.25);
  return [w - padLon, s - padLat, e + padLon, n + padLat];
}

export function AlertNotifier() {
  const viewer = useCesiumViewer();
  const enabled = useAlertNotifyStore((s) => s.enabled);
  const categories = useAlertNotifyStore((s) => s.categories);
  const queue = useAlertNotifyStore((s) => s.queue);
  const flashSeq = useAlertNotifyStore((s) => s.flashSeq);
  const flashColor = useAlertNotifyStore((s) => s.flashColor);
  useNoticeSource('nws', enabled && categories.nws);
  useNoticeSource('warn', enabled && categories.warn);
  useNoticeSource('quake', enabled && categories.quake);
  useNoticeSource('nps', enabled && categories.nps);
  useNoticeSource('flight', enabled && categories.flight);
  useNoticeSource('ship', enabled && categories.ship);

  // Re-render once a minute so "expires in …" stays true while a popup waits.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (queue.length === 0) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [queue.length]);

  const head = queue[0];

  // Escape acknowledges the notice on screen — unless something else (a menu,
  // a modal) already handled that Escape.
  useEffect(() => {
    if (!head) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      useAlertNotifyStore.getState().dismiss(head.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [head]);

  const showOnMap = (n: Notice) => {
    const ss = useScreensaverStore.getState();
    if (ss.active) ss.stop();
    // The crisis workspace covers the map unless an incident's map dock is out.
    const crisis = useCrisisStore.getState();
    if (crisis.open && (crisis.activeIncidentId === null || useCrisisDockStore.getState().collapsed)) crisis.close();
    const live = viewer && !viewer.isDestroyed() ? viewer : null;
    const panels = usePanelStore.getState();
    // Windows opened on purpose start locked, like the other deliberately
    // launched ones: the next click on the globe won't close them.
    switch (n.category) {
      case 'nws': {
        ensureLayer('alerts');
        if (live) flyToBoundingBox(live, ...padded(n.bbox));
        panels.open({ ...alertPanelData(n.alert), locked: true });
        break;
      }
      case 'warn': {
        ensureLayer('warn');
        if (live) flyToBoundingBox(live, ...padded(n.bbox));
        const { polygons: _p, circles: _c, ...rest } = n.alert;
        panels.open({
          id: `warn-${n.alert.id}`,
          kind: 'warn',
          title: n.alert.event,
          subtitle: n.alert.sender,
          payload: rest as unknown as Record<string, unknown>,
          locked: true,
        });
        break;
      }
      case 'quake': {
        ensureLayer('earthquakes');
        const q = n.quake;
        if (live) {
          let [w, s, e, nn] = [q.lon, q.lat, q.lon, q.lat];
          for (const { pin } of n.hits) {
            w = Math.min(w, pin.lon);
            e = Math.max(e, pin.lon);
            s = Math.min(s, pin.lat);
            nn = Math.max(nn, pin.lat);
          }
          flyToBoundingBox(live, ...padded([w, s, e, nn]));
        }
        panels.open({
          id: `eq-${q.id}`,
          kind: 'earthquakes',
          title: `M${q.mag.toFixed(1)} Earthquake`,
          subtitle: q.place,
          payload: {
            mag: q.mag,
            place: q.place,
            time: q.time,
            depthKm: q.depthKm,
            url: q.url,
            felt: q.felt,
            tsunami: q.tsunami,
            status: q.status,
          },
          locked: true,
        });
        break;
      }
      case 'nps': {
        // The park, with the company's properties in it, and the panel with the
        // alert's full text and every other alert in effect there.
        ensureLayer('locations');
        const frame = parkFrame(n.alert.parkCode);
        if (live && frame) flyToBoundingBox(live, ...frame);
        openNpsPanel(n.alert.parkCode, n.alert.id);
        break;
      }
      case 'flight':
        ensureLayer('flights');
        if (live) flyToLonLat(live, n.event.lon, n.event.lat, 60_000);
        break;
      case 'ship':
        ensureLayer('ships');
        if (live) flyToLonLat(live, n.event.lon, n.event.lat, 40_000);
        break;
    }
    useAlertNotifyStore.getState().dismiss(n.key);
  };

  return (
    <>
      {flashSeq > 0 && (
        <div
          key={flashSeq}
          aria-hidden
          className="gsoc-alert-flash pointer-events-none fixed inset-0 z-[4500]"
          style={{ '--flash': flashColor } as CSSProperties}
        />
      )}
      {head && (
        <div className="pointer-events-none fixed inset-0 z-[4600] flex items-center justify-center p-4">
          <NoticeCard
            key={head.key}
            notice={head}
            index={0}
            total={queue.length}
            now={now}
            onShow={() => showOnMap(head)}
            onDismiss={() => useAlertNotifyStore.getState().dismiss(head.key)}
            onDismissAll={() => useAlertNotifyStore.getState().dismissAll()}
            onTurnOff={() => useAlertNotifyStore.getState().toggle()}
          />
        </div>
      )}
    </>
  );
}
