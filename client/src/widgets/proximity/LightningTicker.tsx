import { useEffect, useState } from 'react';
import { fetchLightningStatus } from '../../api/lightningApi';
import { startVisiblePolling } from '../../lib/poll';
import type { LightningStatusResponse } from '../../types/lightning';

// Global lightning activity from the server's collector, which records every
// strike around the clock — so the ticker works whether or not the Lightning
// layer is on, and its sparkline is a full hour from the first poll
// (`perMinute`: 60 completed minutes, oldest → newest).
const POLL_MS = 15_000;
// A healthy global stream delivers several strikes a second; a minute of
// silence means the collector isn't hearing the network.
const LIVE_MAX_AGE_S = 60;
// Each poll aborts the one before it, and an aborted poll isn't a failure —
// so a server that answers nothing within the poll never "fails". Two polls
// without an answer means the last one can't vouch for now.
const STALE_MS = 2 * POLL_MS;
// Re-render this often so staleness shows even when no poll ever settles.
const STALE_CHECK_MS = 5_000;

const BOLT = '#ffd60a';

/** Local HH:MM on a 24 h clock, like the top bar. */
const fmtClock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <div className="h-7" />;
  const max = Math.max(1, ...data);
  const n = data.length;
  const pts = data.map((v, i) => {
    const x = (i / (n - 1)) * 100;
    const y = 26 - (v / max) * 24; // 2px headroom top, baseline at 28
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(' ');
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-full">
      <defs>
        <linearGradient id="lightning-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={BOLT} stopOpacity="0.35" />
          <stop offset="100%" stopColor={BOLT} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,28 ${line} 100,28`} fill="url(#lightning-grad)" />
      <polyline
        points={line}
        fill="none"
        stroke={BOLT}
        strokeWidth="1.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * What the ticker may claim. An unreachable server (a failed poll, or no
 * answer for STALE_MS — since mount when none ever came) vouches for
 * nothing: no LIVE, and no "offline" either.
 */
export function tickerHealth(p: {
  collector: LightningStatusResponse['collector'] | null;
  failed: boolean;
  /** Client time of the last successful poll; null until one. */
  lastOkAt: number | null;
  mountedAt: number;
  nowMs: number;
}): { unreachable: boolean; live: boolean; offline: boolean } {
  const { collector: c } = p;
  const unreachable = p.failed || p.nowMs - (p.lastOkAt ?? p.mountedAt) > STALE_MS;
  const offline = !unreachable && c !== null && (!c.connected || c.downSince !== null);
  const live =
    !unreachable && c !== null && c.connected && c.lastStrikeAgeS !== null && c.lastStrikeAgeS < LIVE_MAX_AGE_S;
  return { unreachable, live, offline };
}

export function LightningTicker() {
  const [status, setStatus] = useState<LightningStatusResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [mountedAt] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(mountedAt);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), STALE_CHECK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let ctrl: AbortController | null = null;
    const poll = () => {
      // A slow response is superseded, never stacked behind the next tick.
      ctrl?.abort();
      const c = new AbortController();
      ctrl = c;
      fetchLightningStatus(c.signal)
        .then((s) => {
          if (c.signal.aborted) return;
          setStatus(s);
          setFailed(false);
          setLastOkAt(Date.now());
        })
        .catch(() => {
          if (!c.signal.aborted) setFailed(true);
        });
    };
    const stop = startVisiblePolling(poll, POLL_MS);
    return () => {
      stop();
      ctrl?.abort();
    };
  }, []);

  const collector = status?.collector ?? null;
  const { unreachable, live, offline } = tickerHealth({ collector, failed, lastOkAt, mountedAt, nowMs });

  return (
    <div className="rounded-lg border border-white/8 bg-white/5 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">
          <span aria-hidden>⚡</span> Lightning
        </span>
        {live ? (
          <span className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: BOLT }}>
            <span className="relative flex h-2 w-2">
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                style={{ background: BOLT }}
              />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: BOLT }} />
            </span>
            LIVE
          </span>
        ) : offline ? (
          <span className="text-[10px] font-semibold text-amber-300/80">collector offline</span>
        ) : (
          <span className="text-[10px] text-white/25">idle</span>
        )}
      </div>

      {status && collector ? (
        <>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className={`text-[26px] font-bold leading-none tabular-nums transition-transform ${live ? '' : 'opacity-50'}`}
              style={{ color: BOLT }}
            >
              {collector.ratePerMin.toLocaleString()}
            </span>
            <span className="text-[11px] text-white/40">strikes/min · global</span>
          </div>
          <div className="mt-1.5">
            <Sparkline data={status.perMinute} />
          </div>
          {offline && (
            <div className="mt-1 text-[10px] leading-snug text-amber-300/70">
              {collector.downSince !== null ? `Offline since ${fmtClock(collector.downSince)}` : 'Offline'} — new
              strikes aren’t being recorded.
            </div>
          )}
          {unreachable && (
            <div className="mt-1 text-[10px] leading-snug text-white/35">Server unreachable — retrying.</div>
          )}
        </>
      ) : (
        <div className="mt-1 text-[11px] leading-snug text-white/35">
          {unreachable ? 'Lightning status unavailable — retrying.' : 'Checking the global strike feed…'}
        </div>
      )}
    </div>
  );
}
