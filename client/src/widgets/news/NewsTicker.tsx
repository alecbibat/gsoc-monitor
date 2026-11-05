import { useEffect, useMemo, type CSSProperties } from 'react';
import { api } from '../../api/client';
import { usePanelStore } from '../../panels/panelStore';
import { useScreensaverStore } from '../../screensaver/screensaverStore';
import { useNewsStore } from './newsStore';
import { useSidebarDockStore } from '../../ui/uiStore';
import { startVisiblePolling } from '../../lib/poll';
import { useNpsFeed, useNpsStore } from '../../nps/npsStore';
import { interleaveEvenly, npsTickerItems, type NpsTickerItem } from '../../nps/tickerItems';
import { NPS_CATEGORY, NPS_GREEN } from '../../nps/npsMeta';
import { openNpsPanel } from '../../nps/openNpsPanel';
import type { NewsItem } from '../../types';

// A horizontally-scrolling headline ticker pinned to the bottom of the screen.
// Shown while the Breaking News panel is closed, and kept alive during the pins
// screensaver (Property Watch lives in the clock card and on the globe there).
//
// World headlines run with the National Park Service's items for the followed
// parks spread evenly through them: every alert in effect and the last month
// of news releases. Each NPS item is a green-outlined chip led by an "NPS"
// badge and the park's name — plus the alert's category when it is a danger,
// closure or caution — so they stand out from the world headlines at a glance.
// A news release opens on nps.gov like any headline; an alert opens the
// National Parks panel, which has its full text. The panel's "Show in the
// ticker" switch takes them out.
const REFRESH_MS = 5 * 60_000;

const SEVERITY_DOT: Record<string, string> = {
  alert: '#60a5fa',
  urgent: '#fbbf24',
  critical: '#f87171',
};

type Entry = { nps: false; item: NewsItem } | { nps: true; item: NpsTickerItem };

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

export function NewsTicker() {
  const items = useNewsStore((s) => s.items);
  const severityFilter = useNewsStore((s) => s.severityFilter);
  const categoryFilter = useNewsStore((s) => s.categoryFilter);
  const customSources = useNewsStore((s) => s.customSources);
  const setData = useNewsStore((s) => s.setData);
  const setError = useNewsStore((s) => s.setError);

  const npsInTicker = useNpsStore((s) => s.inTicker);
  const npsFeed = useNpsStore((s) => s.feed);
  const npsUpdated = useNpsStore((s) => s.updated);

  const newsPanelOpen = usePanelStore((s) => s.panels.some((p) => p.kind === 'news-feed'));
  const openPanel = usePanelStore((s) => s.open);
  const screensaverActive = useScreensaverStore((s) => s.active);
  const sidebarCollapsed = useSidebarDockStore((s) => s.collapsed);
  const screensaverMode = useScreensaverStore((s) => s.mode);

  const inPins = screensaverActive && screensaverMode === 'pins';
  const active = !newsPanelOpen && (!screensaverActive || inPins);

  useNpsFeed(active && npsInTicker);

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

  // Rebuilt per feed answer (npsUpdated), not per render, so the 30-day news
  // cut-off is judged once per refresh and the marquee doesn't restart.
  const npsItems = useMemo(
    () => (npsInTicker ? npsTickerItems(npsFeed, npsUpdated ?? Date.now()) : []),
    [npsInTicker, npsFeed, npsUpdated]
  );
  const world = useMemo(
    () => items.filter((i) => severityFilter.has(i.severity) && categoryFilter.has(i.category as never)),
    [items, severityFilter, categoryFilter]
  );
  const entries = useMemo(
    () =>
      interleaveEvenly<Entry, Entry>(
        world.map((item) => ({ nps: false, item })),
        npsItems.map((item) => ({ nps: true, item }))
      ),
    [world, npsItems]
  );

  if (!active || entries.length === 0) return null;

  const npsAlertCount = npsItems.filter((i) => i.kind === 'alert').length;
  const durationS = Math.max(24, entries.length * 7);
  const loop = [...entries, ...entries];

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-10 transition-[left] duration-500 ease-in-out ${
        // Inset for the docked sidebar only when it's actually present (desktop,
        // outside the screensaver, not collapsed). During the pins screensaver
        // the sidebar is hidden, so span the full width — very left to very right.
        screensaverActive || sidebarCollapsed ? '' : 'md:left-72'
      }`}
    >
      <div className="flex min-h-[2.25rem] items-center border-t border-white/10 bg-ink-900/85 pb-safe backdrop-blur-sm">
        {/* Label — click to open the news panel. */}
        <button
          onClick={() =>
            openPanel({
              id: 'widget-news-feed',
              kind: 'news-feed',
              title: 'Breaking News',
              subtitle: 'RSS · live feed',
              payload: {},
              // Same panel the sidebar launcher opens — a tool, not a map popup,
              // so it survives clicks on the globe (see WidgetLauncher).
              locked: true,
            })
          }
          className="flex h-full shrink-0 items-center gap-1.5 border-r border-white/10 bg-red-500/10 px-3 text-[10px] font-bold uppercase tracking-widest text-red-300 transition hover:bg-red-500/20"
          title="Open the Breaking News panel"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
          Breaking
        </button>

        {/* The key to the green chips, and the way into the parks panel. */}
        {npsItems.length > 0 && (
          <button
            onClick={() => openNpsPanel()}
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

        {/* Scrolling headlines. */}
        <div className="relative flex-1 overflow-hidden">
          <div className="animate-marquee flex w-max items-center" style={{ animationDuration: `${durationS}s` }}>
            {loop.map((e, i) =>
              e.nps ? (
                <NpsChip key={`n:${e.item.kind}:${e.item.id}:${i}`} item={e.item} />
              ) : (
                <WorldHeadline key={`w:${e.item.id}:${i}`} item={e.item} />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
