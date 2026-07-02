import type { IntelItem } from '../../types';
import { CATEGORY_META } from './intelStore';

interface Props {
  payload: IntelItem;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const SEVERITY: Record<IntelItem['severity'], { label: string; cls: string }> = {
  urgent: { label: 'URGENT', cls: 'bg-red-500/20 text-red-300 border-red-500/30' },
  watch: { label: 'WATCH', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  info: { label: 'INFO', cls: 'bg-white/10 text-white/50 border-white/15' },
};

export function IntelDetails({ payload }: Props) {
  const { title, text, author, url, publishedAt, lat, lon, place, category, source, severity } = payload;
  const cat = CATEGORY_META[category];
  const sev = SEVERITY[severity];

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold"
            style={{ color: cat.color, background: `${cat.color}22` }}
          >
            {cat.icon} {cat.label}
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${sev.cls}`}>
            {sev.label}
          </span>
        </div>
        <div className="text-[15px] font-bold leading-snug tracking-wide">{title}</div>
      </div>

      {text && text !== title && (
        <p className="text-[12px] leading-relaxed text-white/70">{text}</p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">Source</dt>
        <dd className="text-white/80">{source}</dd>
        {author && (
          <>
            <dt className="text-white/40">By</dt>
            <dd className="text-white/80">{author}</dd>
          </>
        )}
        <dt className="text-white/40">When</dt>
        <dd className="text-white/80">
          {timeAgo(publishedAt)}
          <span className="text-white/30"> · {new Date(publishedAt).toLocaleString()}</span>
        </dd>
        {place && (
          <>
            <dt className="text-white/40">Place</dt>
            <dd className="text-white/80">{place}</dd>
          </>
        )}
        {lat != null && lon != null && (
          <>
            <dt className="text-white/40">Position</dt>
            <dd className="font-mono text-[12px]">
              {lat.toFixed(4)}°, {lon.toFixed(4)}°
            </dd>
          </>
        )}
      </dl>

      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-center text-[12px] font-semibold text-accent/90 transition hover:bg-white/[0.08]"
        >
          Open source {hostOf(url) ? `· ${hostOf(url)}` : ''} ↗
        </a>
      )}
    </div>
  );
}
