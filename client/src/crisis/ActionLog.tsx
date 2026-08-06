import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCrisisStore, selectActive, type ActionEntryType, type ActionLogEntry } from './crisisStore';
import { uploadImage } from '../lib/cloudinary';

// Resize an image File to at most maxDim on the longest edge, return a JPEG data URL.
function compressImage(file: File, maxDim = 1200, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = ev.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function isImageFile(file: File) {
  // Pasted screenshots may lack a useful filename, so check the MIME type too.
  return file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(file.name);
}

// Clipboard images all arrive named "image.png" — stamp them so rows stay distinguishable.
function pastedFileName(mime: string) {
  const ext = mime.split('/')[1]?.split('+')[0] || 'png';
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-').replace('T', '_');
  return `pasted-${stamp}.${ext}`;
}

const TYPE_STYLES = {
  action: 'text-blue-300 bg-blue-400/15 border-blue-400/30',
  event:  'text-amber-300 bg-amber-400/15 border-amber-400/30',
  info:   'text-cyan-300 bg-cyan-400/15 border-cyan-400/30',
};

const STRIP_STYLES = {
  action: 'bg-blue-400/60',
  event:  'bg-amber-400/60',
  info:   'bg-cyan-400/60',
};

const NEXT_TYPE: Record<ActionEntryType, ActionEntryType> = {
  action: 'event',
  event: 'info',
  info: 'action',
};

function fmtTimestamp(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch { return iso; }
}

// ── Table row ─────────────────────────────────────────────────────────────────

function LogRow({
  entry,
  autoFocus,
  onAutoFocused,
}: {
  entry: ActionLogEntry;
  autoFocus?: boolean;
  onAutoFocused?: () => void;
}) {
  const updateActionEntry = useCrisisStore((s) => s.updateActionEntry);
  const removeActionEntry = useCrisisStore((s) => s.removeActionEntry);
  const fileRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  // Bumped per attach; stale async completions must not patch the row.
  const uploadSeq = useRef(0);

  useEffect(() => {
    if (autoFocus) {
      descRef.current?.focus();
      onAutoFocused?.();
    }
  }, [autoFocus, onAutoFocused]);

  const attachFile = async (file: File, name = file.name || 'pasted-image.png') => {
    const seq = ++uploadSeq.current;
    if (isImageFile(file)) {
      // Show the filename immediately so the user knows the upload started.
      updateActionEntry(entry.id, { attachmentName: name, attachmentData: undefined });
      try {
        const dataUrl = await compressImage(file);
        const url = await uploadImage(dataUrl);
        if (uploadSeq.current !== seq) return;
        updateActionEntry(entry.id, { attachmentName: name, attachmentData: url });
      } catch {
        if (uploadSeq.current !== seq) return;
        // Upload failed — keep the name but clear any stale image.
        updateActionEntry(entry.id, { attachmentName: name, attachmentData: undefined });
      }
    } else {
      updateActionEntry(entry.id, { attachmentName: name });
    }
  };

  return (
    <tr
      className="group border-b border-white/6 align-top outline-none"
      tabIndex={-1}
      onPaste={(e) => {
        // Mirror the picker's gating: replacing an attachment requires ✕ first.
        if (entry.attachmentName) return;
        const image = Array.from(e.clipboardData?.files ?? []).find((f) =>
          f.type.startsWith('image/')
        );
        if (!image) return;
        // A paste that also carries text (e.g. spreadsheet cells) stays a text
        // paste — unless the text is just the copied file's own name, which is
        // how macOS Finder file copies arrive.
        const text = e.clipboardData.getData('text/plain').trim();
        if (text && text !== image.name) return;
        e.preventDefault();
        // Bitmap pastes all arrive as "image.png" — stamp those; keep real filenames.
        const name =
          !image.name || image.name === 'image.png' ? pastedFileName(image.type) : image.name;
        void attachFile(image, name);
      }}
    >
      {/* Type badge */}
      <td className="w-20 py-2 pl-2 pr-1">
        <button
          onClick={() =>
            updateActionEntry(entry.id, { entryType: NEXT_TYPE[entry.entryType] })
          }
          className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest transition hover:opacity-80 ${TYPE_STYLES[entry.entryType]}`}
        >
          {entry.entryType}
        </button>
      </td>

      {/* Timestamp */}
      <td className="w-36 py-2 pr-3 text-[10px] text-white/35">
        {fmtTimestamp(entry.timestamp)}
      </td>

      {/* Description */}
      <td className="py-2 pr-3">
        <textarea
          ref={descRef}
          className="w-full resize-none rounded bg-white/4 px-2 py-1 text-[11px] text-white/80 placeholder-white/20 outline-none transition focus:bg-white/6 focus:text-white/90"
          placeholder="Describe the action or event…"
          title="Paste an image (Ctrl+V) to attach it to this row"
          rows={2}
          value={entry.description}
          onChange={(e) => updateActionEntry(entry.id, { description: e.target.value })}
        />
      </td>

      {/* Attachment */}
      <td className="w-36 py-2 pr-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            await attachFile(file);
            e.target.value = '';
          }}
        />
        {entry.attachmentName ? (
          <div className="space-y-1">
            {entry.attachmentData && (
              <img
                src={entry.attachmentData}
                alt={entry.attachmentName}
                className="max-h-20 rounded border border-white/10 object-cover"
              />
            )}
            <div className="flex items-center gap-1">
              <span className="truncate text-[9px] text-accent/80">{entry.attachmentName}</span>
              <button
                onClick={() => updateActionEntry(entry.id, { attachmentName: undefined, attachmentData: undefined })}
                className="shrink-0 text-[9px] text-white/25 hover:text-white/50"
              >
                ✕
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            title="Choose a file — or paste an image (Ctrl+V) with this row focused"
            className="text-[9px] text-white/25 transition hover:text-white/50"
          >
            Attach image… <span className="text-white/15">/ Ctrl+V</span>
          </button>
        )}
      </td>

      {/* Delete */}
      <td className="w-8 py-2 pr-2 text-right">
        <button
          onClick={() => removeActionEntry(entry.id)}
          className="text-[11px] text-white/20 opacity-0 transition hover:text-red-400/70 group-hover:opacity-100"
          aria-label="Delete row"
        >
          ✕
        </button>
      </td>
    </tr>
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
      <div className={`h-0.5 w-full rounded-t-lg ${STRIP_STYLES[entry.entryType]}`} />
      <div className="flex h-[calc(100%-2px)] flex-col p-2">
        <div className="flex items-center justify-between gap-1">
          <span className={`rounded-full border px-1.5 py-0 text-[7px] font-bold uppercase tracking-widest ${TYPE_STYLES[entry.entryType]}`}>
            {entry.entryType}
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
          <span className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest ${TYPE_STYLES[entry.entryType]}`}>
            {entry.entryType}
          </span>
          <span className="text-[11px] text-white/45">{fmtTimestamp(entry.timestamp)}</span>
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
          <img
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

function TimelineView({ entries }: { entries: ActionLogEntry[] }) {
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

// ── Main component ────────────────────────────────────────────────────────────

export function ActionLog() {
  const actionLog = useCrisisStore((s) => selectActive(s)?.actionLog ?? []);
  const addActionEntry = useCrisisStore((s) => s.addActionEntry);
  const [view, setView] = useState<'table' | 'timeline'>('table');
  const [hideInfo, setHideInfo] = useState(false);
  // Focus the new row's description so a Ctrl+V right after "+ Action/Event" lands in it.
  const [focusId, setFocusId] = useState<string | null>(null);

  const infoCount = actionLog.filter((e) => e.entryType === 'info').length;
  const visibleLog = hideInfo ? actionLog.filter((e) => e.entryType !== 'info') : actionLog;

  const handleAdd = (type: ActionEntryType) => {
    // A new info row must not be born hidden by the filter.
    if (type === 'info') setHideInfo(false);
    setFocusId(addActionEntry(type));
    setView('table');
  };

  return (
    <section>
      {/* Header */}
      <div className="mb-3 flex items-center gap-3">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/65">
          Actions &amp; Events Log
        </h3>

        {/* Info filter */}
        {infoCount > 0 && (
          <button
            onClick={() => setHideInfo((h) => !h)}
            className={`ml-auto rounded border px-2.5 py-1 text-[9px] transition ${
              hideInfo
                ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300/80 hover:text-cyan-300'
                : 'border-white/10 text-white/30 hover:text-white/50'
            }`}
          >
            {hideInfo ? `Show info (${infoCount})` : `Hide info (${infoCount})`}
          </button>
        )}

        {/* View toggle */}
        <div className={`flex rounded border border-white/10 text-[9px] ${infoCount > 0 ? '' : 'ml-auto'}`}>
          <button
            onClick={() => setView('table')}
            className={`rounded-l px-2.5 py-1 transition ${view === 'table' ? 'bg-white/10 text-white/70' : 'text-white/30 hover:text-white/50'}`}
          >
            Table
          </button>
          <button
            onClick={() => setView('timeline')}
            className={`rounded-r px-2.5 py-1 transition ${view === 'timeline' ? 'bg-white/10 text-white/70' : 'text-white/30 hover:text-white/50'}`}
          >
            Timeline
          </button>
        </div>

        {/* Add buttons */}
        <div className="flex gap-1.5">
          <button
            onClick={() => handleAdd('action')}
            className="rounded border border-blue-400/25 bg-blue-400/8 px-2.5 py-1 text-[9px] text-blue-300/70 transition hover:border-blue-400/40 hover:text-blue-300"
          >
            + Action
          </button>
          <button
            onClick={() => handleAdd('event')}
            className="rounded border border-amber-400/25 bg-amber-400/8 px-2.5 py-1 text-[9px] text-amber-300/70 transition hover:border-amber-400/40 hover:text-amber-300"
          >
            + Event
          </button>
          <button
            onClick={() => handleAdd('info')}
            className="rounded border border-cyan-400/25 bg-cyan-400/8 px-2.5 py-1 text-[9px] text-cyan-300/70 transition hover:border-cyan-400/40 hover:text-cyan-300"
          >
            + Info
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="rounded-lg border border-white/8 bg-ink-950/60">
        {view === 'table' ? (
          <div className="overflow-x-auto">
            {visibleLog.length === 0 ? (
              <p className="py-8 text-center text-[11px] text-white/25">
                {actionLog.length === 0 ? (
                  <>No entries yet — click <strong>+ Action</strong>, <strong>+ Event</strong> or <strong>+ Info</strong> to begin</>
                ) : (
                  <>All entries are informational and currently hidden</>
                )}
              </p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/8">
                    <th className="py-2 pl-2 text-left text-[9px] font-semibold uppercase tracking-wider text-white/30">Type</th>
                    <th className="py-2 text-left text-[9px] font-semibold uppercase tracking-wider text-white/30">Timestamp</th>
                    <th className="py-2 text-left text-[9px] font-semibold uppercase tracking-wider text-white/30">Description</th>
                    <th className="py-2 text-left text-[9px] font-semibold uppercase tracking-wider text-white/30">Attachment</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleLog.map((entry) => (
                    <LogRow
                      key={entry.id}
                      entry={entry}
                      autoFocus={entry.id === focusId}
                      onAutoFocused={() => setFocusId(null)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="px-4 py-4">
            <TimelineView entries={visibleLog} />
          </div>
        )}
      </div>
    </section>
  );
}
