import { useEffect, useState, useRef } from 'react';
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

const DOT_STYLES = {
  action: 'border-blue-400 bg-blue-400/20',
  event:  'border-amber-400 bg-amber-400/30',
  info:   'border-cyan-400 bg-cyan-400/20',
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

function TimelineView({ entries }: { entries: ActionLogEntry[] }) {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  if (sorted.length === 0) {
    return <p className="py-8 text-center text-[11px] text-white/25">No entries yet</p>;
  }

  return (
    <div className="relative py-2 pl-6">
      {/* Vertical axis */}
      <div
        className="absolute left-[11px] top-4 w-px"
        style={{
          height: `calc(100% - 2rem)`,
          background: 'rgba(255,255,255,0.12)',
        }}
      />

      <div className="space-y-4">
        {sorted.map((entry, i) => (
          <div key={entry.id} className="relative flex gap-3">
            {/* Dot */}
            <div
              className={`absolute -left-[23px] mt-0.5 h-3.5 w-3.5 rounded-full border-2 ${DOT_STYLES[entry.entryType]}`}
            />

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full border px-1.5 py-0 text-[7px] font-bold uppercase tracking-widest ${TYPE_STYLES[entry.entryType]}`}
                >
                  {entry.entryType}
                </span>
                <span className="text-[9px] text-white/35">{fmtTimestamp(entry.timestamp)}</span>
              </div>
              {entry.description ? (
                <p className="mt-1 text-[11px] leading-snug text-white/75">{entry.description}</p>
              ) : (
                <p className="mt-1 text-[11px] text-white/25 italic">No description</p>
              )}
              {entry.attachmentData && (
                <img src={entry.attachmentData} alt={entry.attachmentName} className="mt-1.5 max-h-40 max-w-xs rounded border border-white/10 object-cover" />
              )}
              {entry.attachmentName && !entry.attachmentData && (
                <p className="mt-0.5 text-[9px] text-accent/70">📎 {entry.attachmentName}</p>
              )}
            </div>
          </div>
        ))}
      </div>
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
