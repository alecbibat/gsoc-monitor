import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { ServiceLevel, ServiceStatus } from '../types';
import { DEFAULT_SERVICES, summarizeChip, useServiceStatusStore } from './serviceStatusStore';

// The server re-reads the status pages at most every 2 minutes.
const POLL_MS = 120_000;

const DOT: Record<ServiceLevel, string> = {
  ok: 'bg-accent-ok',
  minor: 'bg-accent-warn',
  major: 'bg-accent-danger',
  unknown: 'bg-white/25',
};
const TEXT: Record<ServiceLevel, string> = {
  ok: 'text-white/85',
  minor: 'text-accent-warn',
  major: 'text-accent-danger',
  unknown: 'text-white/40',
};
const WORD: Record<ServiceLevel, string> = {
  ok: 'Operational',
  minor: 'Degraded',
  major: 'Outage',
  unknown: 'No answer',
};

function useServiceStatus(): { services: ServiceStatus[]; updated: number | null; failed: boolean } {
  const [state, setState] = useState<{ services: ServiceStatus[]; updated: number | null; failed: boolean }>({
    services: [],
    updated: null,
    failed: false,
  });
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .serviceStatus()
        .then((r) => alive && setState({ services: r.services, updated: r.updated, failed: false }))
        // Keep the last answer on screen; the menu says the refresh failed.
        .catch(() => alive && setState((s) => ({ ...s, failed: true })));
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return state;
}

function sinceLabel(iso?: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return '';
  const min = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (min < 60) return `${min}m`;
  if (min < 48 * 60) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

/**
 * Compact "down detector" for the top bar: one dot per chosen provider and a
 * one-line verdict. Click for the incidents behind it and to choose which
 * providers the chip watches. Data is each provider's own public status page.
 */
export function ServiceStatusChip() {
  const { services, updated, failed } = useServiceStatus();
  const selected = useServiceStatusStore((s) => s.selected) ?? DEFAULT_SERVICES;
  const toggle = useServiceStatusStore((s) => s.toggle);
  const reset = useServiceStatusStore((s) => s.reset);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const loading = updated === null && !failed;
  const { shown, issues, level, headline, label } = summarizeChip(services, selected);
  const chipLevel: ServiceLevel = services.length === 0 ? 'unknown' : level;

  return (
    <div ref={ref} className="relative hidden lg:block">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Service status: ${headline} ${label}. Open to see details and choose services.`}
        title="Service status from each provider's status page. Click for details and to choose services."
        className={`pointer-events-auto flex items-center gap-2 rounded-lg border px-3 py-2 shadow-panel backdrop-blur-sm transition-all ${
          open
            ? 'border-accent/40 bg-accent/10'
            : chipLevel === 'major'
            ? 'border-accent-danger/45 bg-ink-900/80 hover:border-accent-danger/70'
            : chipLevel === 'minor'
            ? 'border-accent-warn/35 bg-ink-900/80 hover:border-accent-warn/60'
            : 'border-white/10 bg-ink-900/80 hover:border-white/25'
        }`}
      >
        {shown.length > 0 && (
          // Two rows of dots keep a long selection as narrow as a short one.
          <span
            className={`grid shrink-0 grid-flow-col gap-[3px] ${shown.length > 5 ? 'grid-rows-2' : 'grid-rows-1'}`}
            aria-hidden="true"
          >
            {shown.map((s) => (
              <span
                key={s.id}
                className={`h-1.5 w-1.5 rounded-full ${DOT[s.level]} ${s.level === 'major' ? 'animate-pulse' : ''}`}
              />
            ))}
          </span>
        )}
        <span className="flex flex-col items-end leading-none">
          <span
            className={`max-w-[9rem] truncate text-[13px] font-bold ${TEXT[chipLevel]} ${
              issues.length === 0 ? 'font-mono tabular-nums' : ''
            }`}
          >
            {loading ? '…' : services.length === 0 ? '—' : headline}
          </span>
          <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/30">
            {services.length === 0 ? 'services' : label}
          </span>
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Service status"
          className="pointer-events-auto absolute left-0 top-full z-50 mt-1.5 flex max-h-[min(34rem,calc(100vh-6rem))] w-80 flex-col overflow-hidden rounded-lg border border-white/12 bg-ink-900/95 text-white shadow-2xl backdrop-blur-md"
        >
          <div className="border-b border-white/8 px-3 py-2.5">
            <div className="text-[12.5px] font-semibold text-white/90">Service status</div>
            <div className="text-[10.5px] text-white/40">
              From each provider&rsquo;s own status page
              {updated ? ` · checked ${new Date(updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}
              {failed ? ' · refresh failed' : ''}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {issues.length > 0 && (
              <div className="border-b border-white/8 py-1">
                {issues.map((s) => (
                  <div key={s.id} className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[s.level]}`} />
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className={`text-[12px] font-semibold hover:underline ${TEXT[s.level]}`}
                      >
                        {s.name}
                      </a>
                      <span className="text-[10px] uppercase tracking-wider text-white/35">{WORD[s.level]}</span>
                    </div>
                    <ul className="mt-1 space-y-1 pl-4">
                      {/* Two per provider, so a busy day cannot push the picker off screen. */}
                      {(s.incidents.length > 0 ? s.incidents.slice(0, 2) : [{ title: s.summary, level: s.level }]).map(
                        (inc, i) => (
                          <li key={i} className="text-[11px] leading-snug text-white/65">
                            {'url' in inc && inc.url ? (
                              <a href={inc.url} target="_blank" rel="noreferrer" className="hover:text-white hover:underline">
                                {inc.title}
                              </a>
                            ) : (
                              inc.title
                            )}
                            {'since' in inc && sinceLabel(inc.since) && (
                              <span className="text-white/30"> · {sinceLabel(inc.since)}</span>
                            )}
                          </li>
                        )
                      )}
                      {s.incidents.length > 2 && (
                        <li className="text-[10.5px] text-white/35">
                          +{s.incidents.length - 2} more on the status page
                        </li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between px-3 pb-1 pt-2">
              <span className="text-[9.5px] font-semibold uppercase tracking-wider text-white/35">
                Show in the top bar
              </span>
              <button onClick={reset} className="text-[10px] text-white/35 hover:text-white/70">
                Reset
              </button>
            </div>
            {services.length === 0 && (
              <p className="px-3 pb-3 text-[11px] text-white/45">
                {failed ? 'Could not load service status.' : 'Loading…'}
              </p>
            )}
            <div className="pb-1">
              {services.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-1 hover:bg-white/5">
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={() => toggle(s.id)}
                    className="h-3.5 w-3.5 shrink-0 accent-accent"
                  />
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[s.level]}`} />
                  <span className="shrink-0 text-[12px] text-white/85">{s.name}</span>
                  <span className={`min-w-0 flex-1 truncate text-right text-[10.5px] ${s.level === 'ok' ? 'text-white/30' : TEXT[s.level]}`} title={s.summary}>
                    {s.level === 'ok' ? s.summary : WORD[s.level]}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <p className="border-t border-white/8 px-3 py-1.5 text-[10px] text-white/30">
            Selection saved in this browser. Providers post incidents themselves, so a new outage can lag here.
          </p>
        </div>
      )}
    </div>
  );
}
