interface Props {
  payload: {
    mag: number;
    place: string;
    time: number;
    depthKm: number;
    url: string;
    felt: number | null;
    tsunami: number;
    status: string;
  };
}

function magColor(mag: number) {
  if (mag >= 6) return 'text-accent-danger';
  if (mag >= 4.5) return 'text-accent-warn';
  return 'text-accent-ok';
}

export function EarthquakeDetails({ payload }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-bold tabular-nums ${magColor(payload.mag)}`}>
          M{payload.mag.toFixed(1)}
        </span>
        <span className="text-white/60">{payload.place}</span>
      </div>

      <dl className="grid grid-cols-2 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">Time</dt>
        <dd>{new Date(payload.time).toLocaleString()}</dd>

        <dt className="text-white/40">Depth</dt>
        <dd>{payload.depthKm.toFixed(1)} km</dd>

        <dt className="text-white/40">Felt reports</dt>
        <dd>{payload.felt ?? 'None reported'}</dd>

        <dt className="text-white/40">Tsunami flag</dt>
        <dd>{payload.tsunami ? 'Yes' : 'No'}</dd>

        <dt className="text-white/40">Status</dt>
        <dd className="capitalize">{payload.status}</dd>
      </dl>

      <a
        href={payload.url}
        target="_blank"
        rel="noreferrer"
        className="inline-block text-xs text-accent underline underline-offset-2 hover:text-accent/80"
      >
        View on USGS &rarr;
      </a>
    </div>
  );
}
