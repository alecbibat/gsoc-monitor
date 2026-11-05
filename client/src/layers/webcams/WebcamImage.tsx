import { useEffect, useState } from 'react';
import { startVisiblePolling } from '../../lib/poll';
import type { WebcamInfo } from '../../types';
import { directImageSrc, webcamFreshness } from './webcamMeta';

// A webcam's current still, through the server's proxy, refreshed on the
// camera's own cadence (no faster than every 30 s) while it's on screen. The
// image is fetched rather than set as a plain <img src> so its headers can
// say how old the picture is — a frozen camera then reads as stale instead
// of passing for live (see webcamFreshness).

interface Loaded {
  url: string;
  /** When the operator last replaced the image, epoch ms; null = unknown. */
  updated: number | null;
  /** Since when the server has seen these exact bytes, epoch ms. */
  unchangedSince: number | null;
  /** The server is showing its last good copy because the camera's host failed. */
  hostDown: boolean;
}

const ms = (iso: string | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
};

/**
 * A camera whose host turns servers away: the browser loads it straight from
 * the host, as the park's own pages do. No headers to read, so no age.
 */
function DirectImage({ cam, className }: { cam: WebcamInfo; className: string }) {
  const [stamp, setStamp] = useState(() => Date.now());
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => startVisiblePolling(() => setStamp(Date.now()), Math.max(30, cam.refreshSec) * 1000), [cam.refreshSec]);
  const src = directImageSrc(cam.directUrl!, cam.directBustCache, stamp);
  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black/40">
        {state === 'error' ? (
          <div className="flex aspect-video items-center justify-center text-[11px] text-white/40">Camera unavailable right now</div>
        ) : (
          <img
            src={src}
            alt={`${cam.name} webcam`}
            onLoad={() => setState('ok')}
            onError={() => setState('error')}
            className={`block h-auto w-full ${state === 'loading' ? 'min-h-[8rem]' : ''}`}
          />
        )}
      </div>
      {state === 'ok' && (
        <div className="mt-1 text-[10.5px] text-white/45">
          {cam.timeOnImage ? 'Capture time is printed on the image' : "Camera doesn't say when this was taken"}
        </div>
      )}
    </div>
  );
}

export function WebcamImage({ cam, className = '' }: { cam: WebcamInfo; className?: string }) {
  if (cam.directUrl) return <DirectImage cam={cam} className={className} />;
  return <ProxiedImage cam={cam} className={className} />;
}

function ProxiedImage({ cam, className }: { cam: WebcamInfo; className: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!cam.imagePath) return;
    let alive = true;
    let current: string | null = null;
    const load = async () => {
      try {
        const res = await fetch(cam.imagePath!, { cache: 'no-store' });
        if (!res.ok) throw new Error(res.status === 502 ? 'Camera unavailable right now' : `HTTP ${res.status}`);
        const blob = await res.blob();
        if (!alive) return;
        const known = res.headers.get('X-Webcam-Updated-Known') === '1';
        const url = URL.createObjectURL(blob);
        if (current) URL.revokeObjectURL(current);
        current = url;
        setLoaded({
          url,
          updated: known ? ms(res.headers.get('X-Webcam-Updated')) : null,
          unchangedSince: ms(res.headers.get('X-Webcam-Unchanged-Since')),
          hostDown: res.headers.get('X-Webcam-Stale') === '1',
        });
        setError(null);
        setNow(Date.now());
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    };
    const stop = startVisiblePolling(() => void load(), Math.max(30, cam.refreshSec) * 1000);
    // Keep "updated n min ago" moving between refreshes.
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      stop();
      window.clearInterval(tick);
      if (current) URL.revokeObjectURL(current);
    };
  }, [cam.imagePath, cam.refreshSec]);

  const fresh = loaded
    ? webcamFreshness({
        updated: loaded.updated,
        unchangedSince: loaded.unchangedSince,
        refreshSec: cam.refreshSec,
        now,
        timeOnImage: cam.timeOnImage,
      })
    : null;

  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black/40">
        {loaded ? (
          <img src={loaded.url} alt={`${cam.name} webcam`} className="block h-auto w-full" />
        ) : (
          <div className="flex aspect-video items-center justify-center text-[11px] text-white/40">
            {error ?? 'Loading camera…'}
          </div>
        )}
        {fresh?.stale && (
          <span className="absolute left-2 top-2 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-950">
            Stale
          </span>
        )}
      </div>
      {loaded && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10.5px] text-white/45">
          <span className={fresh?.stale ? 'text-amber-300' : undefined}>
            {fresh?.text ?? "Camera doesn't say when this was taken"}
          </span>
          {loaded.hostDown && <span className="text-amber-300">· camera host not answering, showing the last image</span>}
          {error && <span className="text-amber-300">· refresh failed</span>}
        </div>
      )}
    </div>
  );
}
