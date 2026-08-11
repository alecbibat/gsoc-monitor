import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ActionEntryType, ActionLogEntry } from './crisisStore';
import { ZoomableImage } from './ImageLightbox';

// Pieces of the Actions & Events Log shared between the incident editor
// (ActionLog) and the read-only share page (CrisisShareView): entry styling,
// the snake timeline view, and the show-more pagination bar.

export const TYPE_STYLES: Record<ActionEntryType, string> = {
  action: 'text-blue-300 bg-blue-400/15 border-blue-400/30',
  event:  'text-amber-300 bg-amber-400/15 border-amber-400/30',
  info:   'text-cyan-300 bg-cyan-400/15 border-cyan-400/30',
};

export const STRIP_STYLES: Record<ActionEntryType, string> = {
  action: 'bg-blue-400/60',
  event:  'bg-amber-400/60',
  info:   'bg-cyan-400/60',
};

// Share snapshots are stored as opaque JSON and outlive deploys — entries
// published before entry types existed have no entryType.
export const entryTypeOf = (e: ActionLogEntry): ActionEntryType => e.entryType ?? 'action';

export function fmtLogTimestamp(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch { return iso; }
}

// ── Show-more pagination bar ──────────────────────────────────────────────────

export const DEFAULT_LOG_LIMIT = 10;
const LIMIT_OPTIONS = [25, 50, 100];

export function LogShowMore({ total, limit, onLimitChange }: {
  total: number;
  limit: number;
  onLimitChange: (n: number) => void;
}) {
  if (total <= DEFAULT_LOG_LIMIT) return null;
  const shown = Math.min(limit, total);
  const hidden = total - shown;
  const options = LIMIT_OPTIONS.filter((n) => n > limit && n < total);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/8 px-3 py-2.5">
      <span className="text-[10px] text-white/35">
        Showing {shown} of {total} {total === 1 ? 'entry' : 'entries'}
      </span>
      {options.map((n) => (
        <button
          key={n}
          onClick={() => onLimitChange(n)}
          className="rounded border border-white/10 px-2.5 py-1 text-[10px] text-white/45 transition hover:border-white/25 hover:text-white/70"
        >
          Show {n}
        </button>
      ))}
      {hidden > 0 && (
        <button
          onClick={() => onLimitChange(total)}
          className="rounded border border-white/10 px-2.5 py-1 text-[10px] text-white/45 transition hover:border-white/25 hover:text-white/70"
        >
          Show all {total}
        </button>
      )}
      {limit > DEFAULT_LOG_LIMIT && (
        <button
          onClick={() => onLimitChange(DEFAULT_LOG_LIMIT)}
          className="rounded px-2 py-1 text-[10px] text-white/30 transition hover:text-white/55"
        >
          Show fewer
        </button>
      )}
    </div>
  );
}

// ── Timeline view ─────────────────────────────────────────────────────────────
//
// Entries snake left→right then right→left down the container. Horizontal
// spacing between consecutive cards encodes elapsed time on a log scale
// (saturating at one day) so bursts stay tight and lulls read as long,
// labeled connectors instead of consuming the whole screen.

const CARD_W = 180;
const CARD_H = 118;
const ROW_GAP = 46;
const EDGE_PAD = 24;   // cards keep this margin so U-turn arcs have room
const MIN_GAP = 20;
const MAX_GAP = 110;
const TURN_R = 14;

function humanizeDuration(ms: number) {
  const m = Math.round(ms / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

function fmtCardTs(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

interface SnakeSegment {
  d: string;
  dashed: boolean;
  label?: { text: string; x: number; y: number };
}

function layoutSnake(sorted: ActionLogEntry[], width: number) {
  const times = sorted.map((e) => new Date(e.timestamp).getTime());

  // Shrink cards and cap the largest gap on narrow panels so at least two
  // cards share a row — otherwise long timelines degenerate into one column.
  const innerW = width - 2 * EDGE_PAD;
  const cardW = innerW >= 2 * CARD_W + 60 ? CARD_W : Math.max(140, Math.floor((innerW - 40) / 2));
  const maxGap = Math.max(MIN_GAP + 12, Math.min(MAX_GAP, innerW - 2 * cardW));
  const gapForDelta = (ms: number) => {
    const minutes = Math.max(0, ms) / 60000;
    const frac = Math.min(1, Math.log1p(minutes) / Math.log1p(24 * 60));
    return MIN_GAP + frac * (maxGap - MIN_GAP);
  };

  const left = EDGE_PAD;
  const right = Math.max(width - EDGE_PAD - cardW, left);

  const pos: { x: number; row: number; dir: 1 | -1 }[] = [];
  let x = left, row = 0, dir: 1 | -1 = 1;
  const wrapped: boolean[] = [];

  sorted.forEach((_, i) => {
    pos.push({ x, row, dir });
    if (i === sorted.length - 1) return;
    const gap = gapForDelta(times[i + 1] - times[i]);
    const nextX = x + dir * (cardW + gap);
    if (dir === 1 ? nextX > right : nextX < left) {
      row += 1;
      dir = dir === 1 ? -1 : 1;
      x = dir === 1 ? left : right;
      wrapped[i] = true;
    } else {
      x = nextX;
    }
  });

  const rowCenter = (r: number) => r * (CARD_H + ROW_GAP) + CARD_H / 2;
  const segments: SnakeSegment[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = pos[i], b = pos[i + 1];
    const dt = times[i + 1] - times[i];
    const dashed = dt >= 60 * 60000;
    const text = dt >= 10 * 60000 ? humanizeDuration(dt) : undefined;

    if (!wrapped[i]) {
      const goingRight = b.x > a.x;
      const x1 = goingRight ? a.x + cardW : a.x;
      const x2 = goingRight ? b.x : b.x + cardW;
      const y = rowCenter(a.row);
      segments.push({
        d: `M ${x1} ${y} L ${x2} ${y}`,
        dashed,
        label: text && Math.abs(x2 - x1) >= 40 ? { text, x: (x1 + x2) / 2, y } : undefined,
      });
    } else {
      // U-turn: out to the margin on the side the row was heading, down, back.
      const turnDir = a.dir;
      const sy = rowCenter(a.row);
      const ey = rowCenter(b.row);
      const sx = turnDir === 1 ? a.x + cardW : a.x;
      const ex = turnDir === 1 ? b.x + cardW : b.x;
      const tx = turnDir === 1 ? width - 9 : 9;
      segments.push({
        d: [
          `M ${sx} ${sy}`,
          `L ${tx - turnDir * TURN_R} ${sy}`,
          `Q ${tx} ${sy} ${tx} ${sy + TURN_R}`,
          `L ${tx} ${ey - TURN_R}`,
          `Q ${tx} ${ey} ${tx - turnDir * TURN_R} ${ey}`,
          `L ${ex} ${ey}`,
        ].join(' '),
        dashed,
        label: text ? { text, x: tx - turnDir * 30, y: (sy + ey) / 2 } : undefined,
      });
    }
  }

  const height = (row + 1) * (CARD_H + ROW_GAP) - ROW_GAP;
  return { pos, segments, height, cardW };
}

function SnakeCard({ entry, x, y, w, onOpen }: {
  entry: ActionLogEntry;
  x: number;
  y: number;
  w: number;
  onOpen: () => void;
}) {
  const entryType = entryTypeOf(entry);
  const hasImage = !!entry.attachmentData;
  const truncated =
    entry.description.length > (hasImage ? 70 : 150) || entry.description.includes('\n');

  return (
    <button
      onClick={onOpen}
      title="Click for details"
      className="absolute rounded-lg border border-white/10 bg-ink-900/95 text-left shadow-md transition hover:z-10 hover:-translate-y-0.5 hover:border-white/30 hover:shadow-xl"
      style={{ left: x, top: y, width: w, height: CARD_H }}
    >
      <div className={`h-0.5 w-full rounded-t-lg ${STRIP_STYLES[entryType]}`} />
      <div className="flex h-[calc(100%-2px)] flex-col p-2">
        <div className="flex items-center justify-between gap-1">
          <span className={`rounded-full border px-1.5 py-0 text-[7px] font-bold uppercase tracking-widest ${TYPE_STYLES[entryType]}`}>
            {entryType}
          </span>
          <span className="truncate text-[8px] text-white/40">{fmtCardTs(entry.timestamp)}</span>
        </div>
        {entry.description ? (
          <p className={`mt-1.5 text-[10px] leading-snug text-white/75 ${hasImage ? 'line-clamp-2' : 'line-clamp-4'}`}>
            {entry.description}
          </p>
        ) : (
          <p className="mt-1.5 text-[10px] italic text-white/25">No description</p>
        )}
        {hasImage && (
          <img
            src={entry.attachmentData}
            alt={entry.attachmentName}
            className="mt-auto h-9 w-full rounded border border-white/10 object-cover"
          />
        )}
        {!hasImage && entry.attachmentName && (
          <p className="mt-auto truncate text-[8px] text-accent/70">📎 {entry.attachmentName}</p>
        )}
        {truncated && !hasImage && (
          <span className="absolute bottom-1 right-1.5 text-[8px] text-white/30">⋯ more</span>
        )}
      </div>
    </button>
  );
}

function EntryDetailModal({ entry, onClose }: { entry: ActionLogEntry; onClose: () => void }) {
  const entryType = entryTypeOf(entry);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Portalled to <body>: the crisis overlay uses backdrop-filter, which would
  // otherwise trap this fixed-position backdrop inside the side panel.
  return createPortal(
    <div
      className="fixed inset-0 z-[3200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/12 bg-ink-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2.5">
          <span className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest ${TYPE_STYLES[entryType]}`}>
            {entryType}
          </span>
          <span className="text-[11px] text-white/45">{fmtLogTimestamp(entry.timestamp)}</span>
          <button
            onClick={onClose}
            className="ml-auto rounded px-1.5 text-[13px] text-white/30 transition hover:text-white/70"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {entry.description ? (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-white/85">{entry.description}</p>
        ) : (
          <p className="text-[13px] italic text-white/30">No description</p>
        )}
        {entry.attachmentData && (
          <ZoomableImage
            src={entry.attachmentData}
            alt={entry.attachmentName}
            className="mt-4 max-h-[50vh] w-full rounded-lg border border-white/10 object-contain"
          />
        )}
        {entry.attachmentName && (
          <p className="mt-1.5 text-[10px] text-accent/70">📎 {entry.attachmentName}</p>
        )}
      </div>
    </div>,
    document.body
  );
}

export function TimelineView({ entries }: { entries: ActionLogEntry[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  if (sorted.length === 0) {
    return <p className="py-8 text-center text-[11px] text-white/25">No entries yet</p>;
  }

  const span =
    new Date(sorted[sorted.length - 1].timestamp).getTime() -
    new Date(sorted[0].timestamp).getTime();
  const open = openId ? sorted.find((e) => e.id === openId) : undefined;

  return (
    <div ref={wrapRef} className="relative">
      <div className="mb-3 flex items-baseline justify-between text-[9px] text-white/30">
        <span>
          {sorted.length} {sorted.length === 1 ? 'entry' : 'entries'}
          {span > 0 && <> · spanning {humanizeDuration(span)}</>}
        </span>
        <span>gap length ∝ time between entries · click a card for details</span>
      </div>

      {width > 0 && (() => {
        const { pos, segments, height, cardW } = layoutSnake(sorted, width);
        return (
          <div className="relative" style={{ height }}>
            <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
              {segments.map((s, i) => (
                <path
                  key={i}
                  d={s.d}
                  fill="none"
                  stroke="rgba(255,255,255,0.18)"
                  strokeWidth={1.5}
                  strokeDasharray={s.dashed ? '4 4' : undefined}
                />
              ))}
            </svg>
            {segments.map((s, i) =>
              s.label ? (
                <span
                  key={i}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-white/10 bg-ink-950 px-1.5 py-px text-[8px] text-white/45"
                  style={{ left: s.label.x, top: s.label.y }}
                >
                  {s.label.text}
                </span>
              ) : null
            )}
            {sorted.map((entry, i) => (
              <SnakeCard
                key={entry.id}
                entry={entry}
                x={pos[i].x}
                y={pos[i].row * (CARD_H + ROW_GAP)}
                w={cardW}
                onOpen={() => setOpenId(entry.id)}
              />
            ))}
          </div>
        );
      })()}

      {open && <EntryDetailModal entry={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
