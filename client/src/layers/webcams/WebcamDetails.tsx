import type { Webcam } from '../../types';
import { RefreshingImage } from './RefreshingImage';

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

export function WebcamDetails({ payload }: Props) {
  const active = payload.status.toLowerCase() !== 'disabled';

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

      {/* Live view — the DOT camera's latest frame, refreshed on an interval. */}
      <div className="overflow-hidden rounded-lg border border-white/10 bg-black/40">
        <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
          <RefreshingImage
            url={payload.imageUrl}
            alt={payload.title}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">Source</dt>
        <dd>{payload.source}</dd>

        {payload.roadway && (
          <>
            <dt className="text-white/40">Roadway</dt>
            <dd className="truncate">{payload.roadway}</dd>
          </>
        )}

        <dt className="text-white/40">Owner</dt>
        <dd className="truncate">{payload.source} (state DOT)</dd>

        <dt className="text-white/40">Position</dt>
        <dd className="font-mono text-[12px]">
          {payload.lat.toFixed(4)}°, {payload.lon.toFixed(4)}°
        </dd>
      </dl>

      <div className="flex items-center justify-between pt-0.5">
        {payload.sourceUrl ? (
          <a
            href={payload.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[12px] font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            Open {hostOf(payload.sourceUrl)} ↗
          </a>
        ) : (
          <span />
        )}
        <span className="text-[10px] text-white/30">Image refreshes every ~30s</span>
      </div>
    </div>
  );
}
