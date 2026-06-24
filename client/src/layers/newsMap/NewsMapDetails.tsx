import type { NewsMapEvent } from '../../types';

interface Props {
  payload: NewsMapEvent;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function toneLabel(tone: number | null): { text: string; cls: string } | null {
  if (tone == null) return null;
  if (tone <= -5) return { text: `negative (${tone.toFixed(1)})`, cls: 'text-red-300' };
  if (tone >= 2) return { text: `positive (${tone.toFixed(1)})`, cls: 'text-emerald-300' };
  return { text: `neutral (${tone.toFixed(1)})`, cls: 'text-white/55' };
}

export function NewsMapDetails({ payload }: Props) {
  const { name, count, image, articles, lat, lon, tone } = payload;
  const sentiment = toneLabel(tone);
  const negative = tone != null && tone <= -5;

  return (
    <div className="space-y-3">
      <div>
        <div className="text-lg font-bold leading-tight tracking-wide">{name}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px]">
          <span className={`inline-flex items-center gap-1 ${negative ? 'text-red-300' : 'text-indigo-300'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${negative ? 'bg-red-400' : 'bg-indigo-400'}`} />
            {count} article{count === 1 ? '' : 's'} · recent
          </span>
          {sentiment && (
            <>
              <span className="text-white/25">·</span>
              <span className={sentiment.cls}>{sentiment.text}</span>
            </>
          )}
        </div>
      </div>

      {image && (
        <div className="overflow-hidden rounded-lg border border-white/10 bg-black/40">
          <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
            <img
              src={image}
              alt={name}
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      )}

      {articles.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
            Coverage
          </div>
          <ul className="space-y-1.5">
            {articles.map((a, i) => (
              <li key={i}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-1.5 transition hover:bg-white/[0.07]"
                >
                  <div className="text-[12px] leading-snug text-white/80">{a.title}</div>
                  {hostOf(a.url) && (
                    <div className="mt-0.5 text-[10px] text-indigo-300/70">{hostOf(a.url)} ↗</div>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-[12px] italic text-white/30">No article links available.</div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">Position</dt>
        <dd className="font-mono text-[12px]">
          {lat.toFixed(4)}°, {lon.toFixed(4)}°
        </dd>
        <dt className="text-white/40">Source</dt>
        <dd>GDELT Project</dd>
      </dl>
    </div>
  );
}
