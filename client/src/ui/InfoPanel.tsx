import { useEffect, useState } from 'react';
import { useLayersStore } from '../store/layersStore';
import {
  BASEMAP_PROVENANCE,
  LAYER_PROVENANCE,
  type Provenance,
} from './dataProvenance';

function ProvenanceCard({ info }: { info: Provenance }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.03] p-3">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-[15px]">{info.icon}</span>
        <span className="flex-1 text-[13px] font-semibold text-white/90">{info.name}</span>
        <span className="rounded bg-white/8 px-1.5 py-0.5 text-[10px] font-medium text-white/55">
          {info.source}
        </span>
      </div>

      <dl className="mt-2 space-y-1.5">
        <div>
          <dt className="text-[9px] font-semibold uppercase tracking-wider text-white/30">
            How it's gathered
          </dt>
          <dd className="text-[11px] leading-snug text-white/65">{info.method}</dd>
        </div>
        <div>
          <dt className="text-[9px] font-semibold uppercase tracking-wider text-white/30">
            Why it's trustworthy
          </dt>
          <dd className="text-[11px] leading-snug text-white/65">{info.trust}</dd>
        </div>
      </dl>

      {info.url && (
        <a
          href={info.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-accent/80 transition hover:text-accent"
        >
          {info.url.replace(/^https?:\/\//, '')}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M14 4h6m0 0v6m0-6L10 14M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      )}
    </div>
  );
}

export function InfoPanel() {
  const [open, setOpen] = useState(false);
  const active = useLayersStore((s) => s.active);
  const basemap = useLayersStore((s) => s.basemap);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const activeLayers = LAYER_PROVENANCE.filter((l) => active[l.id]);

  return (
    <div className="pointer-events-auto relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 w-9 items-center justify-center rounded-lg border shadow-panel backdrop-blur-sm transition ${
          open
            ? 'border-accent/50 bg-accent/15 text-accent'
            : 'border-white/10 bg-ink-900/80 text-white/55 hover:text-white'
        }`}
        title="Data sources & provenance"
        aria-label="Data sources and provenance"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 11v5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="12" cy="7.75" r="1.25" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <>
          {/* Outside-click catcher */}
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-[calc(100%+8px)] z-[1001] flex max-h-[78vh] w-[370px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-white/10 bg-ink-900/95 shadow-panel backdrop-blur-md">
            <div className="flex items-start justify-between border-b border-white/10 px-4 py-3">
              <div>
                <div className="text-[13px] font-semibold text-white/90">Data sources</div>
                <div className="text-[11px] text-white/45">
                  How each active layer is gathered & why you can trust it
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-0.5 text-white/40 transition hover:text-white"
                aria-label="Dismiss"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M6 6L18 18M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="hud-scroll space-y-2 overflow-y-auto p-3">
              {activeLayers.length === 0 && (
                <div className="py-4 text-center text-[12px] text-white/40">
                  No data layers are currently on. Toggle a layer to see its source.
                </div>
              )}
              {activeLayers.map((l) => (
                <ProvenanceCard key={l.id} info={l.info} />
              ))}

              {/* Always show the active basemap. */}
              <div className="pt-1 text-[9px] font-semibold uppercase tracking-wider text-white/25">
                Base map
              </div>
              <ProvenanceCard info={BASEMAP_PROVENANCE[basemap]} />
            </div>

            <div className="border-t border-white/8 px-4 py-2 text-[10px] leading-snug text-white/30">
              Every layer is sourced from public agencies, official transponder broadcasts, or
              established providers — no synthetic or unverified data.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
