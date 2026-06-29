import { outlookStyle, drynessLabel, fmtOutlookDate } from './fireOutlookMeta';

interface Payload {
  code: string;
  gacc: string;
  date: string | null;
  dayNum: number;
  dryness: number | null;
  type: string | null;
}

export function FireOutlookDetails({ payload }: { payload: Payload }) {
  const style = outlookStyle(payload.dryness, payload.type);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="rounded px-2 py-0.5 text-xs font-semibold text-ink-950"
          style={{ backgroundColor: style.hex }}
        >
          {style.sig ? style.label : drynessLabel(payload.dryness)}
        </span>
        <span className="text-white/70">
          {style.sig ? 'Significant fire potential' : 'Fuel dryness'}
        </span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">Day</dt>
        <dd>
          Day {payload.dayNum}
          {payload.date ? ` · ${fmtOutlookDate(payload.date)}` : ''}
        </dd>

        <dt className="text-white/40">Significant potential</dt>
        <dd>{payload.type ? style.label : 'None forecast'}</dd>

        <dt className="text-white/40">Fuel dryness</dt>
        <dd>{drynessLabel(payload.dryness)}</dd>

        <dt className="text-white/40">Area</dt>
        <dd>{payload.gacc || '—'}</dd>

        <dt className="text-white/40">PSA</dt>
        <dd className="font-mono">{payload.code}</dd>
      </dl>

      <p className="text-[11px] leading-relaxed text-white/40">
        Predictive Service Area outlook from NWCG National Predictive Services — the chance of
        significant wildland fire for the next 7 days, by fuel dryness and critical fire-weather
        conditions.
      </p>

      <a
        href="https://fsapps.nwcg.gov/psp/npsg/forecast"
        target="_blank"
        rel="noreferrer"
        className="inline-block text-xs text-accent underline underline-offset-2 hover:text-accent/80"
      >
        NWCG 7-Day Outlook &rarr;
      </a>
    </div>
  );
}
