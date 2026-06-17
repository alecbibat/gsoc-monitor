import { useEffect } from 'react';
import { api } from '../../api/client';
import { usePanelStore } from '../../panels/panelStore';
import { useScreensaverStore } from '../../screensaver/screensaverStore';
import { useNewsStore } from './newsStore';

// A horizontally-scrolling headline ticker pinned to the bottom of the screen.
// Shown while the Breaking News panel is closed (the panel and the ticker are
// two views of the same feed), and also kept up during the pins screensaver so
// the property tour still surfaces live headlines along the bottom. It keeps the
// shared news store fresh on its own interval so headlines are live even if the
// panel has never been opened.
const REFRESH_MS = 5 * 60_000;

const SEVERITY_DOT: Record<string, string> = {
  alert: '#60a5fa',
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

  const newsPanelOpen = usePanelStore((s) => s.panels.some((p) => p.kind === 'news-feed'));
  const openPanel = usePanelStore((s) => s.open);
  const screensaverActive = useScreensaverStore((s) => s.active);
  const screensaverMode = useScreensaverStore((s) => s.mode);

  // The ticker is the active news consumer while the panel is closed and either
  // the screensaver is off or we're in the pins (property-tour) screensaver. It
  // fetches on its own cadence in that case so it doesn't double-fetch against
  // the panel's own loop. Other screensaver modes hide it to keep the scene clean.
  const inPins = screensaverActive && screensaverMode === 'pins';
  const active = !newsPanelOpen && (!screensaverActive || inPins);

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
    fetchNews();
    const id = setInterval(fetchNews, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, customSources, setData, setError]);

  if (!active) return null;

  const visible = items.filter(
    (i) => severityFilter.has(i.severity) && categoryFilter.has(i.category)
  );
  if (visible.length === 0) return null;

  // Constant scroll speed regardless of headline count; duplicated for the loop.
  const durationS = Math.max(24, visible.length * 7);
  const loop = [...visible, ...visible];

  return (
    // In pins mode the bottom-right corner holds the context minimap + watch
    // column, so pull the ticker's right edge in (desktop only) to clear it.
    <div
      className={`fixed bottom-0 left-0 right-0 z-10 md:left-72 ${
        inPins ? 'md:right-[280px]' : ''
      }`}
    >
      <div className="flex h-9 items-center border-t border-white/10 bg-ink-900/85 backdrop-blur-sm">
        {/* Label — click to open the full Breaking News panel. */}
        <button
          onClick={() =>
            openPanel({
              id: 'widget-news-feed',
              kind: 'news-feed',
              title: 'Breaking News',
              subtitle: 'GDELT · live feed',
              payload: {},
            })
          }
          className="flex h-full shrink-0 items-center gap-1.5 border-r border-white/10 bg-red-500/10 px-3 text-[10px] font-bold uppercase tracking-widest text-red-300 transition hover:bg-red-500/20"
          title="Open Breaking News panel"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
          Breaking
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
                  style={{ background: SEVERITY_DOT[item.severity] ?? '#94a3b8' }}
                />
                <span className="shrink-0 text-white/40">{item.source}</span>
                <span className="text-white/75 transition group-hover:text-white">{item.title}</span>
                <span className="ml-2 text-white/15">•</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
