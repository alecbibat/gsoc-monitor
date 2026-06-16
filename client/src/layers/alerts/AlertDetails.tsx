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
    effective: string;
    expires: string;
    areaDesc: string;
  };
}

export function AlertDetails({ payload }: Props) {
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

        <dt className="text-white/40">Effective</dt>
        <dd>{new Date(payload.effective).toLocaleString()}</dd>

        <dt className="text-white/40">Expires</dt>
        <dd>{new Date(payload.expires).toLocaleString()}</dd>
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
