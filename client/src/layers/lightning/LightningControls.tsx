import { useLightningStatus, LIGHTNING_WINDOWS } from './lightningStore';
import {
  GAP_CHIP_MIN,
  collectorLine,
  countForWindow,
  fmtClock,
  gapMinutes,
  type ReadoutTone,
} from './lightningReadout';

const TONE: Record<ReadoutTone, string> = {
  ok: 'text-accent-ok/80',
  muted: 'text-white/40',
  warn: 'text-accent-warn',
  danger: 'text-accent-danger',
};

// Sidebar card for the lightning layer. The counts are the server's exact
// totals over every received strike — the globe shows a sample of them — and
// the lines below say how far to trust them: the collector's health, any
// blind spots in the last 24 h, and where live strikes come from.
export function LightningControls() {
  const windowMinutes = useLightningStatus((s) => s.windowMinutes);
  const setWindow = useLightningStatus((s) => s.setWindow);
  const server = useLightningStatus((s) => s.server);
  const fieldError = useLightningStatus((s) => s.field.error);
  const liveSource = useLightningStatus((s) => s.liveSource);

  const label = LIGHTNING_WINDOWS.find((w) => w.value === windowMinutes)?.label ?? '24h';
  const counts = server?.counts ?? null;
  const n = counts ? countForWindow(counts, windowMinutes) : null;
  const health = collectorLine(server, fieldError);
  const gaps = server?.coverage.gaps ?? [];
  const blindMin = gapMinutes(gaps);

  return (
    <div className="space-y-2.5 pt-1">
      {/* Window selector — hides older marks client-side; nothing refetches. */}
      <div>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
          Show strikes from the last
        </div>
        <div className="flex gap-1.5">
          {LIGHTNING_WINDOWS.map((w) => (
            <button
              key={w.value}
              onClick={() => setWindow(w.value)}
              className={`flex-1 rounded px-1.5 py-1 text-[11px] font-medium transition ${
                windowMinutes === w.value
                  ? 'bg-accent/20 text-accent'
                  : 'bg-white/5 text-white/50 hover:bg-white/10'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* Readout */}
      <div className="space-y-0.5 text-[10px] leading-relaxed text-white/45">
        {counts && n !== null ? (
          <div>
            <span
              className="font-semibold tabular-nums text-white/75"
              title={
                counts.exact ? undefined : 'Includes older history that was kept 1-in-6 and is counted ×6'
              }
            >
              {counts.exact ? '' : '≈'}
              {n.toLocaleString()}
            </span>{' '}
            strikes in the last {label}
          </div>
        ) : (
          // With an error and nothing loaded yet, the health line below says it.
          !fieldError && <div>Loading strikes…</div>
        )}
        {health && <div className={TONE[health.tone]}>{health.text}</div>}
        {(blindMin >= GAP_CHIP_MIN || liveSource === 'server') && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {blindMin >= GAP_CHIP_MIN && (
              <span
                className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
                title={gaps.map((g) => `${fmtClock(g.fromMs)}–${fmtClock(g.toMs)}`).join(', ')}
              >
                Blind {blindMin.toLocaleString()} min in 24 h
              </span>
            )}
            {liveSource === 'server' && (
              <span
                className="text-[9px] text-white/35"
                title="This browser can't reach Blitzortung directly, so new strikes arrive through the server every 10 s."
              >
                live via server
              </span>
            )}
          </div>
        )}
      </div>
      {/* The strike-age color key lives on the map itself (LightningLegend via
          MapLegends). */}
    </div>
  );
}
