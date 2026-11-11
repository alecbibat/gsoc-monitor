interface Props {
  payload: {
    event: string;
    headline: string | null;
    description: string;
    instruction: string | null;
    severity: string;
    urgency: string;
    certainty: string;
    senderName: string;
    /** When this message was sent; absent on panels saved before it was carried. */
    sent?: string | null;
    effective: string;
    /** When the hazard begins. */
    onset?: string | null;
    /** When the hazard ends (null: NWS gave none). */
    ends?: string | null;
    /** When this message lapses — usually well before the hazard ends, as NWS re-issues. */
    expires: string;
    areaDesc: string;
  };
}

function fmt(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toLocaleString(undefined, { timeZoneName: 'short' });
}

export function AlertDetails({ payload }: Props) {
  const issued = payload.sent || payload.effective;
  // Only worth a row when the hazard starts later than the message went out.
  const starts =
    payload.onset && Date.parse(payload.onset) > Date.parse(issued) ? fmt(payload.onset) : null;
  // The hazard's own end; `expires` (when this message lapses) only where NWS gives no end.
  const ends = fmt(payload.ends);
  return (
    <div className="space-y-3">
      {payload.headline && (
        <div className="text-[13px] font-medium text-white/90">{payload.headline}</div>
      )}

      <dl className="grid grid-cols-2 gap-y-1.5 text-[13px]">
        <dt className="text-white/40">Severity</dt>
        <dd className="capitalize">{payload.severity}</dd>

        <dt className="text-white/40">Urgency</dt>
        <dd className="capitalize">{payload.urgency}</dd>

        <dt className="text-white/40">Certainty</dt>
        <dd className="capitalize">{payload.certainty}</dd>

        <dt className="text-white/40">Issued by</dt>
        <dd>{payload.senderName}</dd>

        {fmt(issued) && (<><dt className="text-white/40">Issued</dt><dd>{fmt(issued)}</dd></>)}

        {starts && (<><dt className="text-white/40">Starts</dt><dd>{starts}</dd></>)}

        {ends ? (
          <><dt className="text-white/40">Ends</dt><dd>{ends}</dd></>
        ) : (
          fmt(payload.expires) && (<><dt className="text-white/40">Expires</dt><dd>{fmt(payload.expires)}</dd></>)
        )}
      </dl>

      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-white/40">Area</div>
        <p className="text-[13px] text-white/80">{payload.areaDesc}</p>
      </div>

      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-white/40">Description</div>
        <p className="whitespace-pre-wrap text-[13px] text-white/80">{payload.description}</p>
      </div>

      {payload.instruction && (
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-white/40">
            Instructions
          </div>
          <p className="whitespace-pre-wrap text-[13px] text-white/80">{payload.instruction}</p>
        </div>
      )}
    </div>
  );
}
