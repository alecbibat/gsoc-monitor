import { useEffect, useMemo, useRef, useState } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { useLayersStore } from '../../store/layersStore';
import { useNpsFeed, useNpsStore } from '../../nps/npsStore';
import { NPS_PARKS, NPS_PARK_BY_CODE } from '../../nps/parks';
import { NPS_ATTRIBUTION, NPS_CATEGORY, NPS_GREEN, formatNpsDay, relativeNpsDay } from '../../nps/npsMeta';
import { flyToPark } from '../../nps/flyToPark';
import type { NpsAlert, NpsNewsItem } from '../../types';

// ── National Parks panel ─────────────────────────────────────────────────────
// Everything the NPS Data API says about the followed parks: the alerts in
// effect (most serious first) and the latest news releases, filterable by
// park. The ticker's green chips and the NPS alert popups open it scrolled to
// their item. Shares one polling loop with the ticker (useNpsFeed).

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const domId = (id: string) => `nps-item-${id.replace(/[^a-z0-9_-]/gi, '_')}`;

function dayLabel(day: string | null): string | null {
  const abs = formatNpsDay(day);
  const rel = relativeNpsDay(day);
  return abs ? (rel ? `${abs} · ${rel}` : abs) : null;
}

function ExtLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-emerald-300/80 underline-offset-2 transition hover:text-emerald-200 hover:underline"
    >
      {children} ↗
    </a>
  );
}

function AlertCard({
  a,
  open,
  flash,
  showPark,
  onToggle,
  onMap,
}: {
  a: NpsAlert;
  open: boolean;
  flash: boolean;
  showPark: boolean;
  onToggle: () => void;
  onMap: (() => void) | null;
}) {
  const cat = NPS_CATEGORY[a.category];
  const posted = dayLabel(a.postedDay);
  return (
    <div
      id={domId(a.id)}
      className={`rounded-lg border px-3 py-2.5 transition ${flash ? 'ring-2 ring-emerald-400/70' : ''}`}
      style={{ borderColor: `${cat.color}55`, background: `${cat.color}0d` }}
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px]">
        <span
          className="rounded px-1.5 py-px font-bold uppercase tracking-wider"
          style={{ color: cat.color, background: `${cat.color}26` }}
        >
          {cat.label}
        </span>
        {showPark && <span className="font-semibold text-emerald-300/90">{a.park}</span>}
        {posted && (
          <>
            {showPark && <span className="text-white/20">·</span>}
            <span className="text-white/40" title="When the park last posted or edited it">
              {posted}
            </span>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="mt-1 block w-full text-left text-[12.5px] font-semibold leading-snug text-white/90 transition hover:text-white"
      >
        {a.title}
      </button>
      {a.description && (
        <p
          onClick={onToggle}
          className={`mt-1 cursor-pointer whitespace-pre-line text-[11.5px] leading-relaxed text-white/65 ${open ? '' : 'line-clamp-3'}`}
        >
          {a.description}
        </p>
      )}
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px]">
          {a.url && <ExtLink href={a.url}>More info</ExtLink>}
          <ExtLink href={a.conditionsUrl}>Park conditions</ExtLink>
          {a.roadEvents.map((r) =>
            r.url ? (
              <ExtLink key={r.id || r.title} href={r.url}>{`Road event: ${r.title}`}</ExtLink>
            ) : (
              <span key={r.id || r.title} className="text-white/45">Road event: {r.title}</span>
            )
          )}
          {onMap && (
            <button
              type="button"
              onClick={onMap}
              className="ml-auto rounded border border-white/12 px-2 py-0.5 text-white/60 transition hover:bg-white/8 hover:text-white"
            >
              Show on map
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NewsCard({ n, flash, showPark }: { n: NpsNewsItem; flash: boolean; showPark: boolean }) {
  const [imgOk, setImgOk] = useState(true);
  const released = dayLabel(n.releasedDay) ?? timeAgo(n.releasedAt);
  return (
    <a
      id={domId(n.id)}
      href={n.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`group flex gap-2.5 rounded-lg border border-white/5 bg-white/5 px-3 py-2.5 transition hover:border-white/15 hover:bg-white/10 ${
        flash ? 'ring-2 ring-emerald-400/70' : ''
      }`}
    >
      {n.image && imgOk && (
        <img
          src={n.image.url}
          alt={n.image.alt}
          loading="lazy"
          onError={() => setImgOk(false)}
          className="h-14 w-14 shrink-0 rounded object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-white/35">
          {showPark && <span className="font-semibold text-emerald-300/90">{n.park}</span>}
          {showPark && <span className="text-white/20">·</span>}
          <span>{released}</span>
        </div>
        <div className="mt-0.5 text-[12px] font-medium leading-snug text-white/85 group-hover:text-white">{n.title}</div>
        {n.abstract && <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/45">{n.abstract}</div>}
      </div>
    </a>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">{children}</div>;
}

export function NpsWidget() {
  useNpsFeed(true);
  const viewer = useCesiumViewer();
  const feed = useNpsStore((s) => s.feed);
  const updated = useNpsStore((s) => s.updated);
  const loading = useNpsStore((s) => s.loading);
  const error = useNpsStore((s) => s.error);
  const inTicker = useNpsStore((s) => s.inTicker);
  const setInTicker = useNpsStore((s) => s.setInTicker);
  const parkFilter = useNpsStore((s) => s.parkFilter);
  const setParkFilter = useNpsStore((s) => s.setParkFilter);
  const focus = useNpsStore((s) => s.focus);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const handledSeq = useRef(0);

  const alerts = useMemo(() => feed?.alerts ?? [], [feed]);
  const news = useMemo(() => feed?.news ?? [], [feed]);
  const filter = parkFilter === 'all' || NPS_PARK_BY_CODE.has(parkFilter) ? parkFilter : 'all';
  const shownAlerts = filter === 'all' ? alerts : alerts.filter((a) => a.parkCode === filter);
  const shownNews = filter === 'all' ? news : news.filter((n) => n.parkCode === filter);
  const countByPark = useMemo(() => {
    const m = new Map<string, NpsAlert[]>();
    for (const a of alerts) m.set(a.parkCode, [...(m.get(a.parkCode) ?? []), a]);
    return m;
  }, [alerts]);

  // A popup or ticker chip asked for an item: switch to its park, open it and
  // scroll it into view — once the feed holding it has loaded.
  useEffect(() => {
    if (!focus || focus.seq === handledSeq.current || !feed) return;
    handledSeq.current = focus.seq;
    setParkFilter(NPS_PARK_BY_CODE.has(focus.parkCode) ? focus.parkCode : 'all');
    const id = focus.itemId;
    if (!id || !(alerts.some((a) => a.id === id) || news.some((n) => n.id === id))) return;
    setExpanded((prev) => new Set(prev).add(id));
    setFlash(id);
  }, [focus, feed, alerts, news, setParkFilter]);

  useEffect(() => {
    if (!flash) return;
    document.getElementById(domId(flash))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const t = window.setTimeout(() => setFlash(null), 2400);
    return () => window.clearTimeout(t);
  }, [flash]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const showPark = (code: string) => {
    if (!viewer) return;
    const layers = useLayersStore.getState();
    if (!layers.active.locations) layers.toggleLayer('locations');
    flyToPark(viewer, code);
  };

  const park = filter === 'all' ? null : NPS_PARK_BY_CODE.get(filter) ?? null;
  const api = feed?.api;

  return (
    <div className="flex flex-col gap-3">
      {/* Status */}
      <div className="flex items-center justify-between text-[11px]">
        {loading && !feed ? (
          <span className="text-white/40">Loading…</span>
        ) : error ? (
          <span className="text-accent-danger">{error}</span>
        ) : (
          <span className="flex items-center gap-1.5" style={{ color: NPS_GREEN }}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: NPS_GREEN }} />
            NPS · live
          </span>
        )}
        {updated && <span className="shrink-0 pl-2 text-white/30">Updated {timeAgo(updated)}</span>}
      </div>
      {api && !api.keyConfigured && (
        <div className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-[10.5px] leading-snug text-amber-200/90">
          Running on the shared <span className="font-mono">DEMO_KEY</span>, which allows only a few requests an
          hour. Set <span className="font-mono">NPS_API_KEY</span> on the server to keep this current.
        </div>
      )}
      {feed?.alertsError && <div className="text-[10.5px] text-accent-danger">Alerts unavailable: {feed.alertsError}</div>}
      {feed?.newsError && <div className="text-[10.5px] text-accent-danger">News unavailable: {feed.newsError}</div>}

      {/* Park filter, with the alerts in effect at each */}
      <div className="flex flex-wrap gap-1">
        {[{ code: 'all', name: 'All parks' }, ...NPS_PARKS].map((p) => {
          const on = filter === p.code;
          const list = p.code === 'all' ? alerts : countByPark.get(p.code) ?? [];
          const worst = list.find((a) => a.category === 'danger') ?? list.find((a) => a.category === 'closure');
          return (
            <button
              key={p.code}
              type="button"
              onClick={() => setParkFilter(p.code)}
              aria-pressed={on}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] transition ${
                on ? 'text-emerald-100' : 'border-white/10 bg-white/5 text-white/50 hover:text-white/80'
              }`}
              style={on ? { borderColor: `${NPS_GREEN}88`, background: `${NPS_GREEN}22` } : undefined}
            >
              {p.name}
              {list.length > 0 && (
                <span
                  className="rounded-full px-1 text-[9px] font-bold tabular-nums"
                  style={{
                    color: worst ? NPS_CATEGORY[worst.category].color : 'rgba(255,255,255,0.55)',
                    background: 'rgba(255,255,255,0.08)',
                  }}
                  title={`${list.length} alert${list.length === 1 ? '' : 's'} in effect`}
                >
                  {list.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {park && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className="font-semibold text-white/85">{park.fullName}</span>
          <ExtLink href={`https://www.nps.gov/${park.code}/planyourvisit/conditions.htm`}>Conditions</ExtLink>
          {viewer && (
            <button
              type="button"
              onClick={() => showPark(park.code)}
              className="ml-auto rounded border border-white/12 px-2 py-0.5 text-[10.5px] text-white/60 transition hover:bg-white/8 hover:text-white"
            >
              Show on map
            </button>
          )}
        </div>
      )}

      {/* Alerts in effect */}
      <div>
        <SectionTitle>{`Alerts in effect (${shownAlerts.length})`}</SectionTitle>
        <div className="space-y-1.5">
          {feed && feed.alerts && shownAlerts.length === 0 && (
            <div className="py-2 text-[12px] text-white/35">
              No alerts in effect{park ? ` at ${park.name}` : ''}.
            </div>
          )}
          {shownAlerts.map((a) => (
            <AlertCard
              key={a.id}
              a={a}
              open={expanded.has(a.id)}
              flash={flash === a.id}
              showPark={!park}
              onToggle={() => toggle(a.id)}
              onMap={viewer ? () => showPark(a.parkCode) : null}
            />
          ))}
        </div>
      </div>

      {/* News releases */}
      <div>
        <SectionTitle>{`News releases (${shownNews.length})`}</SectionTitle>
        <div className="space-y-1.5">
          {feed && feed.news && shownNews.length === 0 && (
            <div className="py-2 text-[12px] text-white/35">No recent news{park ? ` from ${park.name}` : ''}.</div>
          )}
          {shownNews.map((n) => (
            <NewsCard key={n.id} n={n} flash={flash === n.id} showPark={!park} />
          ))}
        </div>
      </div>

      {/* Settings + attribution */}
      <div className="space-y-1.5 border-t border-white/8 pt-2">
        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-white/65">
          <input
            type="checkbox"
            checked={inTicker}
            onChange={(e) => setInTicker(e.target.checked)}
            className="accent-emerald-400"
          />
          Show park alerts and news in the ticker
        </label>
        <p className="text-[10px] leading-snug text-white/30">
          The ticker runs every alert in effect and the last 30 days of news, as green NPS chips. New and updated
          alerts also pop up (bell menu → National Park alerts). Source: {NPS_ATTRIBUTION}.
        </p>
      </div>
    </div>
  );
}
