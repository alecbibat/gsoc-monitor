interface Props {
  payload: {
    name: string;
    classification: string;
    category: number | null;
    color: string;
    windKt: number | null;
    gustKt: number | null;
    pressureMb: number | null;
    latitude: number;
    longitude: number;
    basin: string | null;
    advDate: string | null;
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

export function HurricaneDetails({ payload }: Props) {
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
