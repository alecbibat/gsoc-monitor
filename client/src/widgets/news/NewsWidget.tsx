import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { NewsItem } from '../../types';
import { useNewsStore, type CategoryFilter, type SeverityFilter } from './newsStore';
import { useScreensaverStore } from '../../screensaver/screensaverStore';

const REFRESH_MS = 5 * 60_000;
const PARK_REFRESH_MS = 10 * 60_000;

const BUILTIN_SOURCES = ['BBC News', 'The Guardian', 'Sky News', 'NPR', 'Al Jazeera'];

const PARK_SOURCES = [
  'Grand Canyon NP News', 'Grand Canyon NP Alerts',
  'Death Valley NP News', 'Death Valley NP Alerts',
  'Glacier NP News', 'Glacier NP Alerts',
  'Mount Rushmore NM News', 'Mount Rushmore NM Alerts',
  'Yellowstone NP News', 'Yellowstone NP Alerts',
  'Rocky Mountain NP News', 'Rocky Mountain NP Alerts',
];

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

const PARK_SEVERITY_DOT: Record<string, string> = {
  alert: 'bg-green-400',
  urgent: 'bg-amber-400',
  critical: 'bg-red-400',
};

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
  const customSources = useNewsStore((s) => s.customSources);
  const addCustomSource = useNewsStore((s) => s.addCustomSource);
  const removeCustomSource = useNewsStore((s) => s.removeCustomSource);

  const parkItems = useNewsStore((s) => s.parkItems);
  const parkUpdated = useNewsStore((s) => s.parkUpdated);
  const parkLoading = useNewsStore((s) => s.parkLoading);
  const parkError = useNewsStore((s) => s.parkError);
  const setParkData = useNewsStore((s) => s.setParkData);
  const setParkLoading = useNewsStore((s) => s.setParkLoading);
  const setParkError = useNewsStore((s) => s.setParkError);

  const newsMode = useNewsStore((s) => s.newsMode);
  const setNewsMode = useNewsStore((s) => s.setNewsMode);

  const enqueueNewsPoi = useScreensaverStore((s) => s.enqueueNewsPoi);
  const screensaverActive = useScreensaverStore((s) => s.active);
  const screensaverMode = useScreensaverStore((s) => s.mode);

  const prevSeenRef = useRef<Set<string>>(new Set());

  const [showSources, setShowSources] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [addError, setAddError] = useState('');

  // Breaking news fetch loop.
  useEffect(() => {
    let cancelled = false;
    const fetchNews = async () => {
      setLoading(true);
      try {
        const res = await api.news(customSources.length > 0 ? customSources : undefined);
        if (cancelled) return;
        const prevSeen = prevSeenRef.current;
        if (screensaverActive && screensaverMode === 'global') {
          for (const item of res.items) {
            if (!prevSeen.has(item.id) && item.lat != null && item.lon != null) {
              if (item.severity === 'urgent' || item.severity === 'critical') {
                enqueueNewsPoi({
                  title: item.title,
                  description: `${item.source}${item.countryName ? ` · ${item.countryName}` : ''}`,
                  lat: item.lat,
                  lon: item.lon,
                  altitudeM: 2_500_000,
                  category: 'news',
                  imageUrl: item.image,
                  url: item.url,
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
    return () => { cancelled = true; clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screensaverActive, screensaverMode, customSources]);

  // Park news fetch loop.
  useEffect(() => {
    if (newsMode !== 'park') return;
    let cancelled = false;
    const fetchPark = async () => {
      setParkLoading(true);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newsMode]);

  function handleAddSource() {
    setAddError('');
    const url = newUrl.trim();
    if (!url) return;
    try {
      const parsed = new URL(url);
      const label = newLabel.trim() || parsed.hostname;
      addCustomSource({ url, label });
      setNewUrl('');
      setNewLabel('');
    } catch {
      setAddError('Invalid URL');
    }
  }

  const visible = items.filter(
    (i) => severityFilter.has(i.severity) && categoryFilter.has(i.category as CategoryFilter)
  );
  const isNew = (item: NewsItem) => !seenIds.has(item.id);

  const isPark = newsMode === 'park';
  const activeUpdated = isPark ? parkUpdated : updated;
  const activeLoading = isPark ? parkLoading : loading;
  const activeError = isPark ? parkError : error;

  return (
    <div className="flex flex-col gap-3">
      {/* Mode toggle */}
      <div className="flex gap-1 rounded-lg bg-white/5 p-1">
        <button
          onClick={() => setNewsMode('breaking')}
          className={`flex-1 rounded-md py-1.5 text-[11px] font-semibold transition ${
            !isPark ? 'bg-red-500/20 text-red-300' : 'text-white/30 hover:text-white/60'
          }`}
        >
          🌍 Breaking News
        </button>
        <button
          onClick={() => setNewsMode('park')}
          className={`flex-1 rounded-md py-1.5 text-[11px] font-semibold transition ${
            isPark ? 'bg-green-500/20 text-green-300' : 'text-white/30 hover:text-white/60'
          }`}
        >
          🌲 Park News
        </button>
      </div>

      {/* Status line */}
      <div className="flex items-center justify-between text-[11px]">
        {activeLoading && !activeUpdated ? (
          <span className="text-white/40">Loading…</span>
        ) : activeError ? (
          <span className="text-accent-danger">Error: {activeError}</span>
        ) : (
          <span className="flex items-center gap-1.5" style={{ color: isPark ? '#4ade80' : 'var(--color-accent-ok, #4ade80)' }}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: isPark ? '#4ade80' : 'currentColor' }} />
            {isPark ? 'NPS · live' : 'RSS · live'}
          </span>
        )}
        {activeUpdated && (
          <span className="text-white/30">Updated {timeAgo(activeUpdated)}</span>
        )}
      </div>

      {/* Park mode: simple list without category/severity filters */}
      {isPark && (
        <div className="space-y-1.5 pr-1">
          {activeLoading && parkItems.length === 0 && (
            <div className="py-6 text-center text-[12px] text-white/30">Loading park feeds…</div>
          )}
          {parkItems.length === 0 && !activeLoading && (
            <div className="py-6 text-center text-[12px] text-white/30">No park updates found</div>
          )}
          {parkItems.map((item) => (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group block rounded-lg border border-white/5 bg-white/5 px-3 py-2.5 transition hover:border-white/15 hover:bg-white/10"
            >
              <div className="flex items-start gap-2">
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${PARK_SEVERITY_DOT[item.severity] ?? 'bg-green-400'}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-white/35">
                    <span className="font-semibold text-green-400/80">{item.countryName}</span>
                    <span className="text-white/20">·</span>
                    <span>{item.source.includes('Alert') ? '🔔 Alert' : '📰 News'}</span>
                    <span className="text-white/20">·</span>
                    <span>{timeAgo(item.publishedAt)}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] leading-snug text-white/80 group-hover:text-white">
                    {item.title}
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      {/* Breaking mode: severity + category filters + full list */}
      {!isPark && (
        <>
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

          <div className="text-[11px] text-white/40">
            Showing {visible.length} of {items.length} stories
          </div>

          <div className="space-y-1.5 pr-1">
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
                  {item.image && (
                    <img
                      src={item.image}
                      alt=""
                      loading="lazy"
                      className="h-12 w-12 shrink-0 rounded object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-white/35">
                      <span>{CAT_ICON[item.category as CategoryFilter] ?? '📰'}</span>
                      <span className="uppercase tracking-wide">{CAT_LABEL[item.category as CategoryFilter] ?? item.category}</span>
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

          {/* Sources section */}
          <div className="border-t border-white/8 pt-2">
            <button
              onClick={() => setShowSources(!showSources)}
              className="flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-white/30 transition hover:text-white/50"
            >
              <span>Sources ({BUILTIN_SOURCES.length + customSources.length})</span>
              <span className="transition-transform" style={{ display: 'inline-block', transform: showSources ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▾</span>
            </button>

            {showSources && (
              <div className="mt-2 space-y-1">
                {BUILTIN_SOURCES.map((s) => (
                  <div key={s} className="flex items-center justify-between px-1 py-0.5">
                    <span className="text-[11px] text-white/50">{s}</span>
                    <span className="text-[9px] text-white/20">built-in</span>
                  </div>
                ))}
                {customSources.map((s) => (
                  <div key={s.url} className="group flex items-center justify-between px-1 py-0.5">
                    <span className="truncate text-[11px] text-white/70" title={s.url}>
                      {s.label}
                    </span>
                    <button
                      onClick={() => removeCustomSource(s.url)}
                      className="ml-2 shrink-0 text-[13px] leading-none text-white/25 transition hover:text-red-400"
                      title="Remove source"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="space-y-1.5 pt-2">
                  <input
                    type="url"
                    value={newUrl}
                    onChange={(e) => { setNewUrl(e.target.value); setAddError(''); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddSource()}
                    placeholder="RSS feed URL"
                    className="w-full rounded bg-white/5 px-2 py-1.5 text-[11px] text-white/80 placeholder:text-white/25 outline-none ring-0 transition focus:ring-1 focus:ring-accent/50"
                  />
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddSource()}
                    placeholder="Source name (optional)"
                    className="w-full rounded bg-white/5 px-2 py-1.5 text-[11px] text-white/80 placeholder:text-white/25 outline-none ring-0 transition focus:ring-1 focus:ring-accent/50"
                  />
                  {addError && <div className="text-[10px] text-red-400">{addError}</div>}
                  <button
                    onClick={handleAddSource}
                    className="w-full rounded bg-accent/15 py-1.5 text-[11px] font-semibold text-accent/90 transition hover:bg-accent/25"
                  >
                    + Add Source
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Park sources footer */}
      {isPark && (
        <div className="border-t border-white/8 pt-2">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-white/30">
            Park Feeds ({PARK_SOURCES.length})
          </div>
          <div className="mt-1.5 space-y-0.5">
            {PARK_SOURCES.map((s) => (
              <div key={s} className="flex items-center justify-between px-1 py-0.5">
                <span className="text-[11px] text-white/40">{s}</span>
                <span className="text-[9px] text-white/20">NPS RSS</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
