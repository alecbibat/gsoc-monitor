import { useEffect, useRef } from 'react';
import { api } from '../../api/client';
import type { NewsItem } from '../../types';
import { useNewsStore, type CategoryFilter, type SeverityFilter } from './newsStore';
import { useScreensaverStore } from '../../screensaver/screensaverStore';

const REFRESH_MS = 5 * 60_000;

const SEVERITY_LABEL: Record<SeverityFilter, string> = {
  alert: 'ALERT',
  urgent: 'URGENT',
  critical: 'CRITICAL',
};
const SEVERITY_COLOR: Record<SeverityFilter, string> = {
  alert: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  urgent: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  critical: 'bg-red-500/20 text-red-300 border-red-500/30',
};
const SEVERITY_DOT: Record<SeverityFilter, string> = {
  alert: 'bg-blue-400',
  urgent: 'bg-amber-400',
  critical: 'bg-red-400',
};

const CAT_LABEL: Record<CategoryFilter, string> = {
  conflict: 'Conflict',
  disaster: 'Disaster',
  weather: 'Weather',
  politics: 'Politics',
  economy: 'Economy',
  health: 'Health',
  environment: 'Environment',
};
const CAT_ICON: Record<CategoryFilter, string> = {
  conflict: '⚔',
  disaster: '💥',
  weather: '🌩',
  politics: '🏛',
  economy: '📈',
  health: '🏥',
  environment: '🌿',
};

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function NewsWidget() {
  const items = useNewsStore((s) => s.items);
  const updated = useNewsStore((s) => s.updated);
  const loading = useNewsStore((s) => s.loading);
  const error = useNewsStore((s) => s.error);
  const severityFilter = useNewsStore((s) => s.severityFilter);
  const categoryFilter = useNewsStore((s) => s.categoryFilter);
  const seenIds = useNewsStore((s) => s.seenIds);
  const toggleSeverity = useNewsStore((s) => s.toggleSeverity);
  const toggleCategory = useNewsStore((s) => s.toggleCategory);
  const setData = useNewsStore((s) => s.setData);
  const setLoading = useNewsStore((s) => s.setLoading);
  const setError = useNewsStore((s) => s.setError);

  const enqueueNewsPoi = useScreensaverStore((s) => s.enqueueNewsPoi);
  const screensaverActive = useScreensaverStore((s) => s.active);
  const screensaverMode = useScreensaverStore((s) => s.mode);

  const prevSeenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const fetchNews = async () => {
      setLoading(true);
      try {
        const res = await api.news();
        if (cancelled) return;

        // Detect brand-new items (not in our seen set before this fetch).
        const prevSeen = prevSeenRef.current;
        if (screensaverActive && screensaverMode === 'global') {
          for (const item of res.items) {
            if (!prevSeen.has(item.id) && item.lat != null && item.lon != null) {
              if (item.severity === 'urgent' || item.severity === 'critical') {
                enqueueNewsPoi({
                  title: item.title,
                  description: `${item.source} · ${item.countryName ?? ''}`,
                  lat: item.lat,
                  lon: item.lon,
                  altitudeM: 2_500_000,
                  category: 'news',
                });
              }
            }
          }
        }
        prevSeenRef.current = new Set(res.items.map((i) => i.id));

        setData(res.items, res.updated);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screensaverActive, screensaverMode]);

  const visible = items.filter(
    (i) => severityFilter.has(i.severity) && categoryFilter.has(i.category)
  );

  const isNew = (item: NewsItem) => !seenIds.has(item.id);

  return (
    <div className="flex flex-col gap-3">
      {/* Status line */}
      <div className="flex items-center justify-between text-[11px]">
        {loading && !updated ? (
          <span className="text-white/40">Loading…</span>
        ) : error ? (
          <span className="text-accent-danger">Error: {error}</span>
        ) : (
          <span className="flex items-center gap-1.5 text-accent-ok">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-ok" />
            GDELT · live
          </span>
        )}
        {updated && (
          <span className="text-white/30">Updated {timeAgo(updated)}</span>
        )}
      </div>

      {/* Severity filters */}
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">
          Severity
        </div>
        <div className="flex gap-1.5">
          {(['alert', 'urgent', 'critical'] as SeverityFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => toggleSeverity(s)}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition ${
                severityFilter.has(s)
                  ? SEVERITY_COLOR[s]
                  : 'border-white/10 bg-white/5 text-white/30'
              }`}
            >
              {SEVERITY_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Category filters */}
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">
          Category
        </div>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(CAT_LABEL) as CategoryFilter[]).map((c) => (
            <button
              key={c}
              onClick={() => toggleCategory(c)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
                categoryFilter.has(c)
                  ? 'bg-white/15 text-white/80'
                  : 'bg-white/5 text-white/25 hover:bg-white/10'
              }`}
            >
              {CAT_ICON[c]} {CAT_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      {/* Count */}
      <div className="text-[11px] text-white/40">
        Showing {visible.length} of {items.length} stories
      </div>

      {/* Feed */}
      <div className="hud-scroll max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
        {visible.length === 0 && (
          <div className="py-6 text-center text-[12px] text-white/30">No stories match filters</div>
        )}
        {visible.map((item) => (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group block rounded-lg border border-white/5 bg-white/5 px-3 py-2.5 transition hover:border-white/15 hover:bg-white/10"
          >
            <div className="flex items-start gap-2">
              <span
                className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[item.severity]}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[10px] text-white/35">
                  <span>{CAT_ICON[item.category]}</span>
                  <span className="uppercase tracking-wide">{CAT_LABEL[item.category]}</span>
                  {item.countryName && (
                    <>
                      <span className="text-white/20">·</span>
                      <span>{item.countryName}</span>
                    </>
                  )}
                  <span className="text-white/20">·</span>
                  <span>{timeAgo(item.publishedAt)}</span>
                  {isNew(item) && (
                    <span className="rounded bg-accent/20 px-1 py-0.5 text-[9px] font-bold text-accent">
                      NEW
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[12px] leading-snug text-white/80 group-hover:text-white">
                  {item.title}
                </div>
                <div className="mt-0.5 text-[10px] text-white/30">{item.source}</div>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
