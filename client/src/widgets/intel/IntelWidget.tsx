import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { flyToLonLat } from '../../cesium/flyTo';
import { useIntelStore, CATEGORY_META } from '../../layers/intel/intelStore';
import { startVisiblePolling } from '../../lib/poll';
import type { IntelCategory, IntelItem, WatchlistSource } from '../../types';

const REFRESH_MS = 90_000;
const CATEGORY_ORDER: IntelCategory[] = ['scanner', 'crime', 'crash', 'fire', 'weather', 'news', 'social', 'other'];

// The source kinds, presented in the plain language of the request: "add a news
// website", "a social account", "a scanner agency". Each preset declares which
// fields the add-form should collect.
type FieldKey = 'url' | 'query' | 'handle' | 'agencyId' | 'domain' | 'dataset';
interface KindPreset {
  kind: string;
  label: string;
  hint: string;
  fields: Array<{ key: FieldKey; placeholder: string; label: string }>;
  category?: IntelCategory;
  pinnable?: boolean; // offer an optional "pin stories to a place" field
}
const KIND_PRESETS: KindPreset[] = [
  {
    kind: 'rss',
    label: 'News website (RSS)',
    hint: 'Any site with an RSS/Atom feed — paste its feed URL.',
    fields: [{ key: 'url', label: 'Feed URL', placeholder: 'https://example.com/rss' }],
    category: 'news',
    pinnable: true,
  },
  {
    kind: 'google-news',
    label: 'News topic (Google News)',
    hint: 'A search we care about — Google News surfaces matching stories.',
    fields: [{ key: 'query', label: 'Search', placeholder: 'Yellowstone flooding OR closure' }],
    category: 'news',
    pinnable: true,
  },
  {
    kind: 'bluesky-author',
    label: 'Bluesky account',
    hint: 'Follow one account’s posts (e.g. a local agency or reporter).',
    fields: [{ key: 'handle', label: 'Handle', placeholder: 'nws.bsky.social' }],
    category: 'social',
    pinnable: true,
  },
  {
    kind: 'bluesky-search',
    label: 'Bluesky keyword',
    hint: 'Every post mentioning a keyword across Bluesky.',
    fields: [{ key: 'query', label: 'Keyword', placeholder: 'wildfire evacuation' }],
    category: 'social',
    pinnable: true,
  },
  {
    kind: 'pulsepoint',
    label: 'Scanner (PulsePoint)',
    hint: 'Fire/EMS dispatch for one PulsePoint agency id.',
    fields: [{ key: 'agencyId', label: 'Agency ID', placeholder: 'EMS1384' }],
    category: 'scanner',
  },
  {
    kind: 'socrata',
    label: 'Crime dataset (Socrata)',
    hint: 'A city open-data crime feed — its host + dataset id.',
    fields: [
      { key: 'domain', label: 'Host', placeholder: 'data.cityofchicago.org' },
      { key: 'dataset', label: 'Dataset id', placeholder: 'ijzp-q8t2' },
    ],
    category: 'crime',
  },
  {
    kind: 'chp',
    label: 'CHP dispatch (California)',
    hint: 'Statewide California Highway Patrol incidents. No config needed.',
    fields: [],
  },
];

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const SEV_DOT: Record<IntelItem['severity'], string> = {
  urgent: 'bg-red-400',
  watch: 'bg-amber-400',
  info: 'bg-white/30',
};

export function IntelWidget() {
  const viewer = useCesiumViewer();
  const items = useIntelStore((s) => s.items);
  const updated = useIntelStore((s) => s.updated);
  const sourceCount = useIntelStore((s) => s.sourceCount);
  const errors = useIntelStore((s) => s.errors);
  const loading = useIntelStore((s) => s.loading);
  const error = useIntelStore((s) => s.error);
  const categories = useIntelStore((s) => s.categories);
  const toggleCategory = useIntelStore((s) => s.toggleCategory);

  const [sources, setSources] = useState<WatchlistSource[]>([]);
  const [showSources, setShowSources] = useState(false);
  const [presetIdx, setPresetIdx] = useState(0);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [label, setLabel] = useState('');
  const [place, setPlace] = useState('');
  const [addError, setAddError] = useState('');
  const [busy, setBusy] = useState(false);

  // Feed poll (also runs when the map layer is off, so the widget is usable alone).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      useIntelStore.getState().setLoading(true);
      try {
        const data = await api.intel();
        if (!cancelled) useIntelStore.getState().setData(data.items, data.updated, data.sourceCount, data.errors);
      } catch {
        if (!cancelled) useIntelStore.getState().setError('Intel feed unavailable');
      }
    };
    const stop = startVisiblePolling(() => void load(), REFRESH_MS);
    return () => { cancelled = true; stop(); };
  }, []);

  const loadSources = async () => {
    try {
      setSources(await api.watchlist());
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not load watchlist');
    }
  };
  useEffect(() => {
    void loadSources();
  }, []);

  const preset = KIND_PRESETS[presetIdx];

  async function handleAdd() {
    setAddError('');
    const trimmedLabel = label.trim();
    if (!trimmedLabel) { setAddError('Give the source a name'); return; }
    // Split fields into url vs config per the preset.
    let url: string | null = null;
    const config: Record<string, unknown> = {};
    for (const f of preset.fields) {
      const v = (fields[f.key] ?? '').trim();
      if (!v) { setAddError(`${f.label} is required`); return; }
      if (f.key === 'url') url = v;
      else config[f.key] = v;
    }
    if (preset.category) config.category = preset.category;
    // Optional location pin for feed sources — server geocodes it to a region
    // so the source's stories can appear on the map, not just in the feed.
    if (preset.pinnable && place.trim()) config.place = place.trim();
    setBusy(true);
    try {
      await api.addWatchSource({ kind: preset.kind, label: trimmedLabel, url, config });
      setLabel('');
      setFields({});
      setPlace('');
      await loadSources();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed to add source');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleSource(s: WatchlistSource) {
    setSources((prev) => prev.map((x) => (x.id === s.id ? { ...x, active: !x.active } : x)));
    try {
      await api.setWatchSourceActive(s.id, !s.active);
    } catch {
      await loadSources(); // revert to server truth on failure
    }
  }

  async function handleDeleteSource(s: WatchlistSource) {
    setSources((prev) => prev.filter((x) => x.id !== s.id));
    try {
      await api.deleteWatchSource(s.id);
    } catch {
      await loadSources();
    }
  }

  function handleFeedClick(item: IntelItem) {
    if (viewer && item.lat != null && item.lon != null) {
      flyToLonLat(viewer, item.lon, item.lat, 120_000);
    } else if (item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    }
  }

  const filterOn = categories.size > 0;
  const visible = filterOn ? items.filter((i) => categories.has(i.category)) : items;

  // Chips: categories present in the feed, plus any currently-selected category
  // even if its items have aged out — otherwise the user is stranded in an
  // empty filtered view with no chip left to clear.
  const present = CATEGORY_ORDER.filter(
    (c) => categories.has(c) || items.some((i) => i.category === c)
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Status line */}
      <div className="flex items-center justify-between text-[11px]">
        {loading && !updated ? (
          <span className="text-white/40">Loading intel…</span>
        ) : error ? (
          <span className="text-accent-danger">{error}</span>
        ) : (
          <span className="flex items-center gap-1.5 text-accent-ok">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            {sourceCount} source{sourceCount === 1 ? '' : 's'} · live
          </span>
        )}
        {updated > 0 && <span className="text-white/30">Updated {timeAgo(updated)}</span>}
      </div>

      {errors.length > 0 && (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[10px] text-amber-300/70">
          {errors.length} source{errors.length === 1 ? '' : 's'} degraded this cycle: {errors.slice(0, 3).join(', ')}
          {errors.length > 3 ? '…' : ''}
        </div>
      )}

      {/* Category filter chips */}
      {present.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {present.map((c) => {
            const on = categories.has(c);
            const m = CATEGORY_META[c];
            return (
              <button
                key={c}
                onClick={() => toggleCategory(c)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
                  on ? '' : 'text-white/40 hover:text-white/70'
                }`}
                style={on ? { color: m.color, background: `${m.color}22` } : { background: 'rgba(255,255,255,0.05)' }}
              >
                {m.icon} {m.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="text-[11px] text-white/40">
        Showing {visible.length} of {items.length} items
        {filterOn && ' · filtered'}
      </div>

      {/* Feed */}
      <div className="space-y-1.5 pr-1">
        {visible.length === 0 && (
          <div className="py-6 text-center text-[12px] text-white/30">
            {items.length === 0 ? 'Ingesting…' : 'No items match the filter'}
          </div>
        )}
        {visible.slice(0, 150).map((item) => {
          const m = CATEGORY_META[item.category];
          return (
            <button
              key={item.id}
              onClick={() => handleFeedClick(item)}
              className="group block w-full rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-left transition hover:border-white/15 hover:bg-white/10"
            >
              <div className="flex items-start gap-2">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEV_DOT[item.severity]}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-white/35">
                    <span style={{ color: m.color }}>{m.icon} {m.label}</span>
                    <span className="text-white/20">·</span>
                    <span className="truncate">{item.source}</span>
                    <span className="text-white/20">·</span>
                    <span className="shrink-0">{timeAgo(item.publishedAt)}</span>
                    {item.lat != null && <span className="shrink-0 text-white/25" title="On map">📍</span>}
                  </div>
                  <div className="mt-0.5 text-[12px] leading-snug text-white/80 group-hover:text-white">
                    {item.title}
                  </div>
                  {item.author && <div className="mt-0.5 text-[10px] text-white/30">{item.author}</div>}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Watchlist management */}
      <div className="border-t border-white/8 pt-2">
        <button
          onClick={() => setShowSources(!showSources)}
          className="flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-white/30 transition hover:text-white/50"
        >
          <span>Watchlist ({sources.length})</span>
          <span
            className="inline-block transition-transform"
            style={{ transform: showSources ? 'rotate(0deg)' : 'rotate(-90deg)' }}
          >
            ▾
          </span>
        </button>

        {showSources && (
          <div className="mt-2 space-y-2">
            <p className="text-[10px] leading-relaxed text-white/35">
              Sources are shared with the whole team. Add a news site, a topic, a scanner, a crime
              feed, or a social account and it starts flowing into the feed within ~90s.
            </p>

            {/* Existing sources */}
            <div className="space-y-1">
              {sources.map((s) => (
                <div key={s.id} className="group flex items-center justify-between gap-2 px-1 py-0.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] text-white/70" title={s.url ?? JSON.stringify(s.config)}>
                      {s.label}
                    </div>
                    <div className="text-[9px] text-white/25">{s.kind}</div>
                  </div>
                  <button
                    onClick={() => handleToggleSource(s)}
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold transition ${
                      s.active ? 'bg-accent-ok/15 text-accent-ok' : 'bg-white/5 text-white/30'
                    }`}
                    title={s.active ? 'Active — click to pause' : 'Paused — click to enable'}
                  >
                    {s.active ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={() => handleDeleteSource(s)}
                    className="shrink-0 text-[13px] leading-none text-white/25 transition hover:text-red-400"
                    title="Remove source"
                  >
                    ×
                  </button>
                </div>
              ))}
              {sources.length === 0 && (
                <div className="px-1 text-[11px] text-white/25">No custom sources yet.</div>
              )}
            </div>

            {/* Add form */}
            <div className="space-y-1.5 rounded-lg border border-white/8 bg-white/[0.03] p-2">
              <select
                value={presetIdx}
                onChange={(e) => { setPresetIdx(Number(e.target.value)); setFields({}); setPlace(''); setAddError(''); }}
                className="w-full rounded bg-white/5 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:ring-1 focus:ring-accent/50"
              >
                {KIND_PRESETS.map((p, i) => (
                  <option key={p.kind} value={i} className="bg-ink-900">
                    {p.label}
                  </option>
                ))}
              </select>
              <div className="text-[10px] text-white/35">{preset.hint}</div>

              <input
                type="text"
                value={label}
                onChange={(e) => { setLabel(e.target.value); setAddError(''); }}
                placeholder="Name (shown in the feed)"
                className="w-full rounded bg-white/5 px-2 py-1.5 text-[11px] text-white/80 placeholder:text-white/25 outline-none focus:ring-1 focus:ring-accent/50"
              />
              {preset.fields.map((f) => (
                <input
                  key={f.key}
                  type={f.key === 'url' ? 'url' : 'text'}
                  value={fields[f.key] ?? ''}
                  onChange={(e) => { setFields((prev) => ({ ...prev, [f.key]: e.target.value })); setAddError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  placeholder={f.placeholder}
                  className="w-full rounded bg-white/5 px-2 py-1.5 text-[11px] text-white/80 placeholder:text-white/25 outline-none focus:ring-1 focus:ring-accent/50"
                />
              ))}
              {preset.pinnable && (
                <input
                  type="text"
                  value={place}
                  onChange={(e) => { setPlace(e.target.value); setAddError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  placeholder="Pin stories to a place (optional) — e.g. Great Falls, MT"
                  className="w-full rounded bg-white/5 px-2 py-1.5 text-[11px] text-white/80 placeholder:text-white/25 outline-none focus:ring-1 focus:ring-accent/50"
                />
              )}
              {addError && <div className="text-[10px] text-red-400">{addError}</div>}
              <button
                onClick={handleAdd}
                disabled={busy}
                className="w-full rounded bg-accent/15 py-1.5 text-[11px] font-semibold text-accent/90 transition hover:bg-accent/25 disabled:opacity-50"
              >
                {busy ? 'Adding…' : '+ Add to watchlist'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
