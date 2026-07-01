interface Props {
  payload: {
    name: string;
    classification: string;
    color: string;
    latitude: number;
    longitude: number;
    basin: string | null;
    // active-storm fields
    category?: number | null;
    windKt?: number | null;
    gustKt?: number | null;
    pressureMb?: number | null;
    advDate?: string | null;
    // disturbance (GTWO) fields
    disturbance?: boolean;
    prob2day?: string;
    risk2day?: string;
    prob7day?: string;
    risk7day?: string;
    // JTWC invest fields
    invest?: boolean;
    investId?: string;
    potential?: string;
  };
}

function ktToMph(kt: number): number {
  return Math.round(kt * 1.15078);
}
function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`;
}
function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
}
function pctNum(s: string | undefined): number {
  const m = (s ?? '').match(/(\d+)/);
  return m ? Math.min(100, Number(m[1])) : 0;
}

// Formation-odds row with a little probability bar.
function OddsRow({ label, prob, color }: { label: string; prob?: string; color: string }) {
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between text-[12px]">
        <span className="text-white/55">{label}</span>
        <span className="font-bold tabular-nums" style={{ color }}>
          {prob || '—'}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${pctNum(prob)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export function HurricaneDetails({ payload }: Props) {
  // --- JTWC invest (developing area in a non-NHC basin) ---
  if (payload.invest) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span
            className="rounded px-2 py-0.5 text-xs font-semibold text-ink-950"
            style={{ backgroundColor: payload.color }}
          >
            {payload.potential ?? 'Low'}
          </span>
          <span className="text-white/70">Formation potential</span>
        </div>

        <p className="text-[13px] leading-relaxed text-white/70">
          Invest {payload.investId ?? ''} — an area JTWC is monitoring for tropical-cyclone
          development.
        </p>

        <dl className="grid grid-cols-2 gap-y-1.5 text-[13px]">
          <dt className="text-white/40">Center</dt>
          <dd className="tabular-nums">
            {formatLat(payload.latitude)} {formatLon(payload.longitude)}
          </dd>
          {payload.basin && (
            <>
              <dt className="text-white/40">Basin</dt>
              <dd>{payload.basin}</dd>
            </>
          )}
        </dl>

        <p className="text-[11px] leading-relaxed text-white/40">
          The Joint Typhoon Warning Center tracks &ldquo;invests&rdquo; in the Western Pacific, Indian
          Ocean, and Southern Hemisphere — the basins NHC doesn&rsquo;t cover. Potential (Low / Medium /
          High) is its 24-hour chance of developing into a significant tropical cyclone.
        </p>

        <a
          href="https://www.metoc.navy.mil/jtwc/jtwc.html"
          target="_blank"
          rel="noreferrer"
          className="inline-block text-xs text-accent underline underline-offset-2 hover:text-accent/80"
        >
          JTWC &rarr;
        </a>
      </div>
    );
  }

  // --- Area of disturbance (formation outlook) ---
  if (payload.disturbance) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span
            className="rounded px-2 py-0.5 text-xs font-semibold text-ink-950"
            style={{ backgroundColor: payload.color }}
          >
            {payload.risk7day ?? 'Low'}
          </span>
          <span className="text-white/70">Area to watch for development</span>
        </div>

        <div className="space-y-2.5">
          <OddsRow label="Next 48 hours" prob={payload.prob2day} color={payload.color} />
          <OddsRow label="Next 7 days" prob={payload.prob7day} color={payload.color} />
        </div>

        <dl className="grid grid-cols-2 gap-y-1.5 text-[13px]">
          <dt className="text-white/40">Center</dt>
          <dd className="tabular-nums">
            {formatLat(payload.latitude)} {formatLon(payload.longitude)}
          </dd>
          {payload.basin && (
            <>
              <dt className="text-white/40">Basin</dt>
              <dd>{payload.basin}</dd>
            </>
          )}
        </dl>

        <p className="text-[11px] leading-relaxed text-white/40">
          NHC tracks this area for tropical-cyclone formation. The percentages are the chance a named
          system develops within 2 and 7 days.
        </p>

        <a
          href="https://www.nhc.noaa.gov/gtwo.php"
          target="_blank"
          rel="noreferrer"
          className="inline-block text-xs text-accent underline underline-offset-2 hover:text-accent/80"
        >
          NHC Tropical Weather Outlook &rarr;
        </a>
      </div>
    );
  }

  // --- Active storm ---
  const wind = payload.windKt;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="rounded px-2 py-0.5 text-xs font-semibold text-ink-950"
          style={{ backgroundColor: payload.color }}
        >
          {payload.category != null ? `CAT ${payload.category}` : payload.classification}
        </span>
        <span className="text-white/70">{payload.classification}</span>
      </div>

      {wind != null && (
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums" style={{ color: payload.color }}>
            {ktToMph(wind)}
          </span>
          <span className="text-white/50">mph sustained ({wind} kt)</span>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">Position</dt>
        <dd className="tabular-nums">
          {formatLat(payload.latitude)} {formatLon(payload.longitude)}
        </dd>

        {payload.gustKt != null && (
          <>
            <dt className="text-white/40">Gusts</dt>
            <dd className="tabular-nums">
              {ktToMph(payload.gustKt)} mph ({payload.gustKt} kt)
            </dd>
          </>
        )}

        {payload.pressureMb != null && (
          <>
            <dt className="text-white/40">Min pressure</dt>
            <dd className="tabular-nums">{payload.pressureMb} mb</dd>
          </>
        )}

        {payload.basin && (
          <>
            <dt className="text-white/40">Basin</dt>
            <dd>{payload.basin}</dd>
          </>
        )}

        {payload.advDate && (
          <>
            <dt className="text-white/40">Advisory</dt>
            <dd>{payload.advDate}</dd>
          </>
        )}
      </dl>

      <a
        href="https://www.nhc.noaa.gov/cyclones/"
        target="_blank"
        rel="noreferrer"
        className="inline-block text-xs text-accent underline underline-offset-2 hover:text-accent/80"
      >
        View on NHC &rarr;
      </a>
    </div>
  );
}
