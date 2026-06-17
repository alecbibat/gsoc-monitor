import { useState } from 'react';
import type { Webcam } from '../../types';

interface Props {
  payload: Webcam;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function fmtAge(ms: number | null): string {
  if (ms == null) return 'unknown';
  const sec = Math.max(0, (Date.now() - ms) / 1000);
  if (sec < 90) return 'just now';
  if (sec < 5400) return `${Math.round(sec / 60)}m ago`;
  if (sec < 172800) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

export function WebcamDetails({ payload }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const active = payload.status.toLowerCase() === 'active';
  const owner = hostOf(payload.providerUrl);
  const stale = payload.lastUpdated != null && Date.now() - payload.lastUpdated > 6 * 3600_000;

  return (
    <div className="space-y-3">
      <div>
        <div className="text-lg font-bold leading-tight tracking-wide">{payload.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px]">
          <span
            className={`inline-flex items-center gap-1 ${active ? 'text-accent-ok' : 'text-amber-300/90'}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${active ? 'animate-pulse bg-accent-ok' : 'bg-amber-400'}`}
            />
            {active ? 'Live' : 'Offline'}
          </span>
          <span className="text-white/30">·</span>
          <span className="text-white/50">
            {payload.distanceMi} mi from {payload.nearestPin}
          </span>
        </div>
      </div>

      {/* Live view — Windy's embed player always shows the latest frame/loop.
          Falls back to the most recent still, then a placeholder. */}
      <div className="overflow-hidden rounded-lg border border-white/10 bg-black/40">
        <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
          {payload.playerEmbedUrl ? (
            <iframe
              src={payload.playerEmbedUrl}
              title={payload.title}
              className="absolute inset-0 h-full w-full"
              frameBorder="0"
              allow="autoplay; fullscreen"
            />
          ) : payload.previewUrl && !imgFailed ? (
            <img
              src={payload.previewUrl}
              alt={payload.title}
              className="absolute inset-0 h-full w-full object-cover"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/40">
              Live view unavailable
            </div>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">Last image</dt>
        <dd className={stale ? 'text-amber-300/90' : undefined}>{fmtAge(payload.lastUpdated)}</dd>

        <dt className="text-white/40">Source</dt>
        <dd>Windy Webcams</dd>

        <dt className="text-white/40">Owner</dt>
        <dd className="truncate">
          {payload.providerUrl && owner ? (
            <a
              href={payload.providerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent/85 transition hover:text-accent"
            >
              {owner}
            </a>
          ) : (
            owner || '—'
          )}
        </dd>

        {payload.categories.length > 0 && (
          <>
            <dt className="text-white/40">Type</dt>
            <dd className="truncate">{payload.categories.join(', ')}</dd>
          </>
        )}

        <dt className="text-white/40">Position</dt>
        <dd className="font-mono text-[12px]">
          {payload.lat.toFixed(4)}°, {payload.lon.toFixed(4)}°
        </dd>
      </dl>

      <div className="flex items-center justify-between pt-0.5">
        {payload.detailUrl ? (
          <a
            href={payload.detailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[12px] font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            Open on Windy ↗
          </a>
        ) : (
          <span />
        )}
        <span className="text-[10px] text-white/30">Webcams via Windy.com</span>
      </div>
    </div>
  );
}
