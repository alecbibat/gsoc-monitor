import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api } from '../../api/client';
import { usePanelStore } from '../../panels/panelStore';
import { useScreensaverStore } from '../../screensaver/screensaverStore';
import { useNewsStore } from './newsStore';
import { useSidebarDockStore } from '../../ui/uiStore';
import { startVisiblePolling } from '../../lib/poll';
import { useNpsFeed, useNpsStore } from '../../nps/npsStore';
import { interleaveEvenly, npsOnlyEmptyText, npsTickerItems, type NpsTickerItem } from '../../nps/tickerItems';
import { NPS_CATEGORY, NPS_GREEN } from '../../nps/npsMeta';
import { openNpsPanel } from '../../nps/openNpsPanel';
import type { LiveBlogItem, LiveBlogResponse, NewsItem } from '../../types';

// A horizontally-scrolling headline ticker pinned to the bottom of the screen.
// Shown while the Breaking News panel is closed, and kept alive during the pins
// screensaver (Property Watch lives in the clock card and on the globe there).
//
// Two modes, switched by clicking the label (and remembered per browser):
//   BREAKING   — world headlines with the National Park Service's items for
//                the followed parks spread evenly through them: every alert
//                in effect and the last month of news releases, as
//                green-outlined chips led by an "NPS" badge and the park's
//                name (plus the alert's category when it is a danger, closure
//                or caution), so they stand out at a glance. The National
//                Parks panel's "Show in the ticker" switch takes them out.
//   NPS ALERTS — only the parks' alerts in effect.
// A news release opens on nps.gov like any headline; an alert opens the
// National Parks panel, which has its full text. The button at the right end
// opens the panel for the mode: Breaking News, or National Parks.
//
// Above it runs a second row, HUFFPOST LIVE: the posts of HuffPost's rolling
// live-updates blog, newest first, each with its time and a link to the post.
// The LIVE button at the right end of the bar switches the row off and on
// (remembered per browser).
const REFRESH_MS = 5 * 60_000;
const LIVE_REFRESH_MS = 2 * 60_000;
/** Short lists repeat so one pass of the marquee still spans the bar. */
const MIN_LOOP_ITEMS = 6;

const SEVERITY_DOT: Record<string, string> = {
  alert: '#60a5fa',
  urgent: '#fbbf24',
  critical: '#f87171',
};

export type TickerEntry = { nps: false; item: NewsItem } | { nps: true; item: NpsTickerItem };

const NPS_CHIP_STYLE: CSSProperties = { borderColor: `${NPS_GREEN}70`, background: `${NPS_GREEN}1f` };

function NpsBadge() {
  return (
    <span
      className="shrink-0 rounded-full px-1.5 py-px text-[9px] font-extrabold tracking-[0.14em] text-ink-950"
      style={{ background: NPS_GREEN }}
    >
      NPS
    </span>
  );
}

function NpsChip({ item }: { item: NpsTickerItem }) {
  const cat = item.kind === 'alert' && item.category !== 'info' ? NPS_CATEGORY[item.category] : null;
  const body = (
    <>
      <NpsBadge />
      <span className="shrink-0 font-semibold text-emerald-200">{item.park}</span>
      {cat && (
        <span
          className="shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wider"
          style={{ color: cat.color, background: `${cat.color}26` }}
        >
          {cat.short}
        </span>
      )}
      <span className="text-white/90 transition group-hover:text-white">{item.title}</span>
    </>
  );
  const className =
    'group mx-3 inline-flex items-center gap-2 rounded-full border py-[3px] pl-[3px] pr-3 text-[12px] transition hover:brightness-125';
  if (item.kind === 'news') {
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        style={NPS_CHIP_STYLE}
        title={`${item.park} news release: open on nps.gov`}
      >
        {body}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={() => openNpsPanel(item.parkCode, item.id)}
      className={className}
      style={NPS_CHIP_STYLE}
      title={`${item.park} alert: open it in the National Parks panel`}
    >
      {body}
    </button>
  );
}

function WorldHeadline({ item }: { item: NewsItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group mx-4 inline-flex items-center gap-2 text-[12px]"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SEVERITY_DOT[item.severity] ?? '#94a3b8' }} />
      <span className="shrink-0 text-white/40">{item.source}</span>
      <span className="text-white/75 transition group-hover:text-white">{item.title}</span>
      <span className="ml-2 text-white/15">•</span>
    </a>
  );
}

/** One pass of a marquee (short lists repeated to span the bar), twice over for the seamless loop. */
function marqueeLoop<T>(items: T[]): { loop: T[]; durationS: number } {
  const reps = items.length > 0 ? Math.ceil(MIN_LOOP_ITEMS / items.length) : 1;
  const pass = reps > 1 ? Array.from({ length: reps }, () => items).flat() : items;
  return { loop: [...pass, ...pass], durationS: Math.max(24, pass.length * 7) };
}

/** "9:09 AM" for a post from today, "Mon 9:09 AM" for an older one. */
export function liveTime(publishedAt: number, now: number): string {
  if (!publishedAt) return '';
  const d = new Date(publishedAt);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date(now).toDateString()) return time;
  return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

function LiveHeadline({ item, now }: { item: LiveBlogItem; now: number }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group mx-4 inline-flex items-center gap-2 text-[12px]"
    >
      <span className="shrink-0 tabular-nums text-violet-300/70">{liveTime(item.publishedAt, now)}</span>
      <span className="text-white/75 transition group-hover:text-white">{item.title}</span>
      <span className="ml-2 text-white/15">•</span>
    </a>
  );
}

/** The HuffPost Live row, above the headlines. */
function LiveRow({ live }: { live: LiveBlogResponse }) {
  const { loop, durationS } = marqueeLoop(live.items);
  const now = Date.now();
  return (
    <div className="flex min-h-[2rem] items-center border-t border-white/10 bg-ink-900/85 backdrop-blur-sm">
      <a
        href={live.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex shrink-0 items-center gap-1.5 self-stretch border-r border-white/10 bg-violet-500/10 px-3 text-[10px] font-bold uppercase tracking-widest text-violet-300 transition hover:bg-violet-500/20"
        title={live.title ? `HuffPost live updates: ${live.title}. Open the live blog.` : 'Open the HuffPost live blog'}
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
        HuffPost Live
      </a>
      <div className="relative flex-1 overflow-hidden">
        <div className="animate-marquee flex w-max items-center" style={{ animationDuration: `${durationS}s` }}>
          {loop.map((item, i) => (
            <LiveHeadline key={`${item.id}:${i}`} item={item} now={now} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PanelIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
    </svg>
  );
}

interface TickerBarProps {
  /** Park alerts only (the label reads NPS ALERTS) rather than all headlines. */
  npsOnly: boolean;
  entries: TickerEntry[];
  npsAlertCount: number;
  /** The "NPS · n alerts" key beside the label, with the headlines. */
  showNpsKey: boolean;
  /** Shown in the NPS-alerts mode when there is nothing to run. */
  emptyText: string;
  insetForSidebar: boolean;
  /** HuffPost's live blog, or null before its first answer. */
  live: LiveBlogResponse | null;
  /** The HuffPost Live row is switched on. */
  liveOn: boolean;
  onToggleLive: () => void;
  onToggleMode: () => void;
  onOpenNpsPanel: () => void;
  onOpenModePanel: () => void;
}

/** The bar itself. Store-free, so each mode renders (and tests) on its own. */
export function TickerBar({
  npsOnly,
  entries,
  npsAlertCount,
  showNpsKey,
  emptyText,
  insetForSidebar,
  live,
  liveOn,
  onToggleLive,
  onToggleMode,
  onOpenNpsPanel,
  onOpenModePanel,
}: TickerBarProps) {
  const { loop, durationS } = marqueeLoop(entries);
  const panelLabel = npsOnly ? 'Open the National Parks panel' : 'Open the Breaking News panel';

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-10 transition-[left] duration-500 ease-in-out ${
        insetForSidebar ? 'md:left-72' : ''
      }`}
    >
      {liveOn && live && live.items.length > 0 && <LiveRow live={live} />}
      <div className="flex min-h-[2.25rem] items-center border-t border-white/10 bg-ink-900/85 pb-safe backdrop-blur-sm">
        {/* Label — click to switch between all headlines and park alerts only. */}
        <button
          type="button"
          onClick={onToggleMode}
          aria-pressed={npsOnly}
          className={`flex h-full shrink-0 items-center gap-1.5 border-r border-white/10 px-3 text-[10px] font-bold uppercase tracking-widest transition ${
            npsOnly
              ? 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
              : 'bg-red-500/10 text-red-300 hover:bg-red-500/20'
          }`}
          title={
            npsOnly
              ? 'Showing National Park Service alerts only. Click to show all headlines.'
              : 'Click to show only National Park Service alerts'
          }
        >
          <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${npsOnly ? 'bg-emerald-400' : 'bg-red-400'}`} />
          {npsOnly ? 'NPS alerts' : 'Breaking'}
          {npsOnly && npsAlertCount > 0 && (
            <span className="font-semibold tabular-nums tracking-normal text-white/45">{npsAlertCount}</span>
          )}
        </button>

        {/* With the headlines: the key to the green chips, and the way into the parks panel. */}
        {showNpsKey && (
          <button
            type="button"
            onClick={onOpenNpsPanel}
            className="hidden h-full shrink-0 items-center gap-1.5 border-r border-white/10 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200/80 transition hover:bg-emerald-500/10 hover:text-emerald-100 sm:flex"
            title="Green chips are National Park Service alerts and news. Open the National Parks panel."
          >
            <NpsBadge />
            {npsAlertCount > 0 && (
              <span className="tabular-nums normal-case tracking-normal text-white/50">
                {npsAlertCount} alert{npsAlertCount === 1 ? '' : 's'}
              </span>
            )}
          </button>
        )}

        {/* Scrolling headlines (restarted from the top when the mode changes). */}
        <div className="relative flex-1 overflow-hidden">
          {entries.length > 0 ? (
            <div
              key={npsOnly ? 'nps' : 'all'}
              className="animate-marquee flex w-max items-center"
              style={{ animationDuration: `${durationS}s` }}
            >
              {loop.map((e, i) =>
                e.nps ? (
                  <NpsChip key={`n:${e.item.kind}:${e.item.id}:${i}`} item={e.item} />
                ) : (
                  <WorldHeadline key={`w:${e.item.id}:${i}`} item={e.item} />
                )
              )}
            </div>
          ) : (
            <div className="truncate px-4 text-[12px] text-white/45">{emptyText}</div>
          )}
        </div>

        {/* The HuffPost Live row above, on or off. */}
        <button
          type="button"
          onClick={onToggleLive}
          aria-pressed={liveOn}
          className={`flex h-full shrink-0 items-center gap-1.5 border-l border-white/10 px-2.5 text-[10px] font-bold uppercase tracking-widest transition ${
            liveOn
              ? 'bg-violet-500/10 text-violet-300 hover:bg-violet-500/20'
              : 'text-white/35 hover:bg-white/5 hover:text-white/75'
          }`}
          title={liveOn ? 'Hide the HuffPost Live row' : 'Show the HuffPost Live row above the ticker'}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${liveOn ? 'bg-violet-400' : 'bg-white/30'}`} />
          Live
        </button>

        {/* The panel for what's running: Breaking News, or National Parks. */}
        <button
          type="button"
          onClick={onOpenModePanel}
          className="flex h-full shrink-0 items-center border-l border-white/10 px-2.5 text-white/35 transition hover:bg-white/5 hover:text-white/75"
          title={panelLabel}
          aria-label={panelLabel}
        >
          <PanelIcon />
        </button>
      </div>
    </div>
  );
}

export function NewsTicker() {
  const items = useNewsStore((s) => s.items);
  const severityFilter = useNewsStore((s) => s.severityFilter);
  const categoryFilter = useNewsStore((s) => s.categoryFilter);
  const customSources = useNewsStore((s) => s.customSources);
  const setData = useNewsStore((s) => s.setData);
  const setError = useNewsStore((s) => s.setError);
  const liveOn = useNewsStore((s) => s.liveRow);
  const setLiveOn = useNewsStore((s) => s.setLiveRow);
  const [live, setLive] = useState<LiveBlogResponse | null>(null);

  const npsInTicker = useNpsStore((s) => s.inTicker);
  const npsOnly = useNpsStore((s) => s.tickerNpsOnly);
  const setNpsOnly = useNpsStore((s) => s.setTickerNpsOnly);
  const npsFeed = useNpsStore((s) => s.feed);
  const npsUpdated = useNpsStore((s) => s.updated);
  const npsError = useNpsStore((s) => s.error);

  const newsPanelOpen = usePanelStore((s) => s.panels.some((p) => p.kind === 'news-feed'));
  const openPanel = usePanelStore((s) => s.open);
  const screensaverActive = useScreensaverStore((s) => s.active);
  const sidebarCollapsed = useSidebarDockStore((s) => s.collapsed);
  const screensaverMode = useScreensaverStore((s) => s.mode);

  const inPins = screensaverActive && screensaverMode === 'pins';
  const active = !newsPanelOpen && (!screensaverActive || inPins);

  useNpsFeed(active && (npsInTicker || npsOnly));

  // Kept fresh in the NPS-alerts mode too, so switching back has headlines to
  // show at once (one cached request every few minutes).
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const fetchNews = async () => {
      try {
        const res = await api.news(customSources.length > 0 ? customSources : undefined);
        if (!cancelled) setData(res.items, res.updated);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    };
    const stop = startVisiblePolling(() => void fetchNews(), REFRESH_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [active, customSources, setData, setError]);

  // The live blog, while its row is on. A failed refresh keeps the last answer.
  useEffect(() => {
    if (!active || !liveOn) return;
    let cancelled = false;
    const stop = startVisiblePolling(() => {
      api
        .liveBlog()
        .then((res) => {
          if (!cancelled) setLive(res);
        })
        .catch(() => {});
    }, LIVE_REFRESH_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [active, liveOn]);

  // Rebuilt per feed answer (npsUpdated), not per render, so the 30-day news
  // cut-off is judged once per refresh and the marquee doesn't restart.
  const npsItems = useMemo(() => {
    const now = npsUpdated ?? Date.now();
    if (npsOnly) return npsTickerItems(npsFeed, now, { alertsOnly: true });
    return npsInTicker ? npsTickerItems(npsFeed, now) : [];
  }, [npsOnly, npsInTicker, npsFeed, npsUpdated]);
  const world = useMemo(
    () => items.filter((i) => severityFilter.has(i.severity) && categoryFilter.has(i.category as never)),
    [items, severityFilter, categoryFilter]
  );
  const entries = useMemo(() => {
    const nps = npsItems.map((item): TickerEntry => ({ nps: true, item }));
    if (npsOnly) return nps;
    return interleaveEvenly<TickerEntry, TickerEntry>(
      world.map((item) => ({ nps: false, item })),
      nps
    );
  }, [npsOnly, world, npsItems]);

  // The NPS-alerts mode keeps its bar even with nothing to run: the label is
  // the way back to the headlines.
  if (!active || (!npsOnly && entries.length === 0)) return null;

  const openNewsPanel = () =>
    openPanel({
      id: 'widget-news-feed',
      kind: 'news-feed',
      title: 'Breaking News',
      subtitle: 'RSS · live feed',
      payload: {},
      // Same panel the sidebar launcher opens — a tool, not a map popup,
      // so it survives clicks on the globe (see WidgetLauncher).
      locked: true,
    });

  return (
    <TickerBar
      npsOnly={npsOnly}
      entries={entries}
      npsAlertCount={npsItems.filter((i) => i.kind === 'alert').length}
      showNpsKey={!npsOnly && npsItems.length > 0}
      emptyText={npsOnlyEmptyText(npsFeed, npsError)}
      // Inset for the docked sidebar only when it's actually present (desktop,
      // outside the screensaver, not collapsed). During the pins screensaver
      // the sidebar is hidden, so span the full width — very left to very right.
      insetForSidebar={!screensaverActive && !sidebarCollapsed}
      live={live}
      liveOn={liveOn}
      onToggleLive={() => setLiveOn(!liveOn)}
      onToggleMode={() => setNpsOnly(!npsOnly)}
      onOpenNpsPanel={() => openNpsPanel()}
      onOpenModePanel={npsOnly ? () => openNpsPanel() : openNewsPanel}
    />
  );
}
