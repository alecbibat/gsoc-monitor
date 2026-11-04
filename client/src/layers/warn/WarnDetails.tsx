import { useEffect, useState, type ReactNode } from 'react';
import { loadCountyAtlas } from '../alerts/alertsData';
import type { WarnAlert } from '../../types';
import { STATE_ABBR, WARN_ATTRIBUTION, WARN_SITE, WEA_CLASSES } from './warnMeta';

type Payload = Omit<WarnAlert, 'polygons' | 'circles'>;

function fmt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

/** "Park, WY · Cecil, MD" from county FIPS codes, once the county atlas is loaded. */
function useCountyNames(fips: string[]): string | null {
  const key = fips.join(',');
  const [names, setNames] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    loadCountyAtlas()
      .then((atlas) => {
        if (cancelled) return;
        const out = key.split(',').map((f) => {
          const name = (atlas.objects.get(f)?.properties as { name?: string } | undefined)?.name;
          const st = STATE_ABBR[f.slice(0, 2)];
          return name ? `${name}${st ? `, ${st}` : ''}` : f;
        });
        setNames(out.join(' · '));
      })
      .catch(() => { if (!cancelled) setNames(null); });
    return () => { cancelled = true; };
  }, [key]);
  return names;
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wide text-white/40">{label}</div>
      {children}
    </div>
  );
}

export function WarnDetails({ payload }: { payload: Payload }) {
  const cls = WEA_CLASSES[payload.weaClass] ?? WEA_CLASSES['public-safety'];
  const counties = useCountyNames(payload.counties ?? []);
  const long = payload.weaLongText && payload.weaLongText !== payload.weaText ? payload.weaLongText : null;
  const headline =
    payload.headline && payload.headline !== payload.weaText && payload.headline !== payload.weaLongText
      ? payload.headline
      : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em]">
        <span className="rounded px-1.5 py-0.5" style={{ color: cls.color, background: `${cls.color}22`, boxShadow: `inset 0 0 0 1px ${cls.color}66` }}>
          {cls.label}
        </span>
        <span className="text-white/40">Wireless Emergency Alert</span>
        {payload.msgType === 'update' && <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/60">Update</span>}
      </div>

      {payload.weaText && (
        <div className="rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2.5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">Sent to phones</div>
          <p className="text-[14px] font-medium leading-snug text-white/90">{payload.weaText}</p>
          {long && <p className="mt-2 text-[13px] leading-snug text-white/75">{long}</p>}
        </div>
      )}

      {headline && <div className="text-[13px] font-medium text-white/85">{headline}</div>}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">Issued by</dt>
        <dd className="break-words">{payload.sender}</dd>
        {payload.severity && (<><dt className="text-white/40">Severity</dt><dd>{payload.severity}</dd></>)}
        {payload.urgency && (<><dt className="text-white/40">Urgency</dt><dd>{payload.urgency}</dd></>)}
        {payload.certainty && (<><dt className="text-white/40">Certainty</dt><dd>{payload.certainty}</dd></>)}
        {payload.responseType && (<><dt className="text-white/40">Response</dt><dd>{payload.responseType}</dd></>)}
        {payload.category && (<><dt className="text-white/40">Category</dt><dd className="capitalize">{payload.category}</dd></>)}
        {fmt(payload.sent) && (<><dt className="text-white/40">Sent</dt><dd>{fmt(payload.sent)}</dd></>)}
        {fmt(payload.expires) && (<><dt className="text-white/40">Expires</dt><dd>{fmt(payload.expires)}</dd></>)}
      </dl>

      {(payload.areaDesc || (payload.counties?.length ?? 0) > 0) && (
        <Section label="Area">
          {payload.areaDesc && <p className="text-[13px] text-white/80">{payload.areaDesc}</p>}
          {(payload.counties?.length ?? 0) > 0 && (
            <p className="text-[12px] text-white/55">{counties ?? payload.counties.join(' · ')}</p>
          )}
        </Section>
      )}

      {payload.description && (
        <Section label="Description">
          <p className="whitespace-pre-wrap text-[13px] text-white/80">{payload.description}</p>
        </Section>
      )}
      {payload.instruction && (
        <Section label="Instructions">
          <p className="whitespace-pre-wrap text-[13px] text-white/80">{payload.instruction}</p>
        </Section>
      )}
      {payload.spanishText && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-white/40 hover:text-white/60">En español</summary>
          <p className="mt-1 whitespace-pre-wrap text-white/75">{payload.spanishText}</p>
        </details>
      )}

      {payload.nws && (
        <p className="text-[11px] text-white/45">Issued by the NWS — the NWS Alerts layer has the full warning.</p>
      )}
      <p className="border-t border-white/8 pt-2 text-[10px] text-white/35">
        {WARN_ATTRIBUTION} ·{' '}
        <a href={WARN_SITE} target="_blank" rel="noreferrer" className="text-white/50 underline-offset-2 hover:text-white/75 hover:underline">
          warn.pbs.org ↗
        </a>
      </p>
    </div>
  );
}
