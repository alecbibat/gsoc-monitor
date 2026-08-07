import { useEffect } from 'react';
import { api } from '../../api/client';
import { usePanelStore } from '../../panels/panelStore';
import { useScreensaverStore } from '../../screensaver/screensaverStore';
import { useNewsStore } from './newsStore';

// A horizontally-scrolling headline ticker pinned to the bottom of the screen.
// Shown while the Breaking News panel is closed, and kept alive during the pins
// screensaver (Property Watch lives in the clock card and on the globe there).
// Mode-aware: shows park news or world breaking news depending on the newsMode
// toggle in the news store.
const REFRESH_MS = 5 * 60_000;
const PARK_REFRESH_MS = 10 * 60_000;

const SEVERITY_DOT: Record<string, string> = {
  alert: '#60a5fa',
  urgent: '#fbbf24',
  critical: '#f87171',
};

const PARK_SEVERITY_DOT: Record<string, string> = {
  alert: '#4ade80',
  urgent: '#fbbf24',
  critical: '#f87171',
};

export function NewsTicker() {
  const items = useNewsStore((s) => s.items);
  const severityFilter = useNewsStore((s) => s.severityFilter);
  const categoryFilter = useNewsStore((s) => s.categoryFilter);
  const customSources = useNewsStore((s) => s.customSources);
  const setData = useNewsStore((s) => s.setData);
  const setError = useNewsStore((s) => s.setError);

  const parkItems = useNewsStore((s) => s.parkItems);
  const setParkData = useNewsStore((s) => s.setParkData);
  const setParkError = useNewsStore((s) => s.setParkError);

  const newsMode = useNewsStore((s) => s.newsMode);
  const setNewsMode = useNewsStore((s) => s.setNewsMode);

  const newsPanelOpen = usePanelStore((s) => s.panels.some((p) => p.kind === 'news-feed'));
  const openPanel = usePanelStore((s) => s.open);
  const screensaverActive = useScreensaverStore((s) => s.active);
  const screensaverMode = useScreensaverStore((s) => s.mode);

  const inPins = screensaverActive && screensaverMode === 'pins';
  const active = !newsPanelOpen && (!screensaverActive || inPins);

  // Breaking news fetch (active when ticker is visible and mode is breaking).
  useEffect(() => {
    if (!active || newsMode !== 'breaking') return;
    let cancelled = false;
    const fetchNews = async () => {
      try {
        const res = await api.news(customSources.length > 0 ? customSources : undefined);
        if (!cancelled) setData(res.items, res.updated);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    };
    fetchNews();
    const id = setInterval(fetchNews, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [active, newsMode, customSources, setData, setError]);

  // Park news fetch (active when ticker is visible and mode is park).
  useEffect(() => {
    if (!active || newsMode !== 'park') return;
    let cancelled = false;
    const fetchPark = async () => {
      try {
        const res = await api.parkNews();
        if (!cancelled) setParkData(res.items, res.updated);
      } catch (e) {
        if (!cancelled) setParkError(String(e));
      }
    };
    fetchPark();
    const id = setInterval(fetchPark, PARK_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [active, newsMode, setParkData, setParkError]);

  if (!active) return null;

  const isPark = newsMode === 'park';

  const visible = isPark
    ? parkItems
    : items.filter((i) => severityFilter.has(i.severity) && categoryFilter.has(i.category as never));

  if (visible.length === 0) return null;

  const durationS = Math.max(24, visible.length * 7);
  const loop = [...visible, ...visible];
  const dotMap = isPark ? PARK_SEVERITY_DOT : SEVERITY_DOT;

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-10 ${
        // Inset for the docked sidebar only when it's actually present (desktop,
        // outside the screensaver). During the pins screensaver the sidebar is
        // hidden, so span the full width — very left to very right.
        screensaverActive ? '' : 'md:left-72'
      }`}
    >
      <div className="flex min-h-[2.25rem] items-center border-t border-white/10 bg-ink-900/85 pb-safe backdrop-blur-sm">
        {/* Label — click to open the news panel. */}
        <button
          onClick={() =>
            openPanel({
              id: 'widget-news-feed',
              kind: 'news-feed',
              title: isPark ? 'Park News' : 'Breaking News',
              subtitle: isPark ? 'NPS · live feed' : 'RSS · live feed',
              payload: {},
            })
          }
          className={`flex h-full shrink-0 items-center gap-1.5 border-r border-white/10 px-3 text-[10px] font-bold uppercase tracking-widest transition ${
            isPark
              ? 'bg-green-500/10 text-green-300 hover:bg-green-500/20'
              : 'bg-red-500/10 text-red-300 hover:bg-red-500/20'
          }`}
          title={isPark ? 'Open Park News panel' : 'Open Breaking News panel'}
        >
          <span
            className={`h-1.5 w-1.5 animate-pulse rounded-full ${isPark ? 'bg-green-400' : 'bg-red-400'}`}
          />
          {isPark ? 'Parks' : 'Breaking'}
        </button>

        {/* Scrolling headlines. */}
        <div className="relative flex-1 overflow-hidden">
          <div
            className="animate-marquee flex w-max items-center"
            style={{ animationDuration: `${durationS}s` }}
          >
            {loop.map((item, i) => (
              <a
                key={`${item.id}-${i}`}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group mx-4 inline-flex items-center gap-2 text-[12px]"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: dotMap[item.severity] ?? '#94a3b8' }}
                />
                <span className="shrink-0 text-white/40">
                  {isPark ? item.countryName : item.source}
                </span>
                <span className="text-white/75 transition group-hover:text-white">{item.title}</span>
                <span className="ml-2 text-white/15">•</span>
              </a>
            ))}
          </div>
        </div>

        {/* Mode toggle pill */}
        <button
          onClick={() => setNewsMode(isPark ? 'breaking' : 'park')}
          className="shrink-0 border-l border-white/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-white/30 transition hover:text-white/60"
          title={isPark ? 'Switch to breaking news' : 'Switch to park news'}
        >
          {isPark ? '🌍' : '🌲'}
        </button>
      </div>
    </div>
  );
}
