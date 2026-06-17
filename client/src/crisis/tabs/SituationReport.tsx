import { useCrisisStore, type IncidentType, type IncidentStatus } from '../crisisStore';
import { IcsOrgChart } from '../IcsOrgChart';

const STATUS_STYLES: Record<IncidentStatus, string> = {
  active:    'border-red-500/50 bg-red-500/15 text-red-400',
  contained: 'border-amber-400/50 bg-amber-400/15 text-amber-300',
  resolved:  'border-green-500/50 bg-green-500/15 text-green-400',
};

const INCIDENT_TYPES: { value: IncidentType; label: string }[] = [
  { value: 'other',          label: 'Other' },
  { value: 'wildfire',       label: 'Wildfire' },
  { value: 'hurricane',      label: 'Hurricane / Tropical Storm' },
  { value: 'earthquake',     label: 'Earthquake' },
  { value: 'flood',          label: 'Flood' },
  { value: 'chemical',       label: 'Chemical / HazMat Spill' },
  { value: 'mass-casualty',  label: 'Mass Casualty Incident' },
  { value: 'cyber',          label: 'Cyber Incident' },
  { value: 'security',       label: 'Security / Active Threat' },
  { value: 'severe-weather', label: 'Severe Weather' },
];

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <label className="w-24 shrink-0 pt-2 text-[10px] text-white/40">{label}</label>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      className="flex-1 rounded border border-white/8 bg-white/5 px-2.5 py-1.5 text-[12px] text-white/80 placeholder-white/20 outline-none transition focus:border-white/20 focus:bg-white/8"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

export function SituationReport() {
  const store = useCrisisStore();

  return (
    <div className="space-y-6">

      {/* Row 1: Executive Summary + Incident Information */}
      <div className="grid grid-cols-2 gap-5">

        {/* Executive Summary */}
        <section className="flex flex-col">
          <h3 className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">
            Executive Summary
          </h3>
          <textarea
            className="flex-1 resize-none rounded-lg border border-white/10 bg-white/4 px-3.5 py-3 text-[13px] leading-relaxed text-white/80 placeholder-white/20 outline-none transition focus:border-white/20 focus:bg-white/5"
            placeholder="Provide a concise summary of the incident, current situation, key impacts, and priority actions required. Update as conditions evolve."
            value={store.executiveSummary}
            onChange={(e) => store.update({ executiveSummary: e.target.value })}
            rows={9}
          />
        </section>

        {/* Incident Information */}
        <section>
          <h3 className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">
            Incident Information
          </h3>
          <div className="space-y-2.5 rounded-lg border border-white/10 bg-white/4 p-4">

            <FieldRow label="Name">
              <TextInput
                value={store.incidentName}
                onChange={(v) => store.update({ incidentName: v })}
                placeholder="e.g. Maui Wildfire Complex"
              />
            </FieldRow>

            <FieldRow label="Date / Time">
              <input
                type="datetime-local"
                className="flex-1 rounded border border-white/8 bg-white/5 px-2.5 py-1.5 text-[12px] text-white/80 outline-none transition focus:border-white/20 focus:bg-white/8"
                value={store.incidentDatetime}
                onChange={(e) => store.update({ incidentDatetime: e.target.value })}
              />
            </FieldRow>

            <FieldRow label="Location">
              <TextInput
                value={store.incidentLocation}
                onChange={(v) => store.update({ incidentLocation: v })}
                placeholder="Affected area or address"
              />
            </FieldRow>

            <FieldRow label="Type">
              <select
                className="flex-1 rounded border border-white/8 bg-ink-900 px-2.5 py-1.5 text-[12px] text-white/80 outline-none transition focus:border-white/20"
                value={store.incidentType}
                onChange={(e) =>
                  store.update({ incidentType: e.target.value as IncidentType })
                }
              >
                {INCIDENT_TYPES.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="Status">
              <div className="flex flex-wrap gap-2">
                {(['active', 'contained', 'resolved'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => store.update({ incidentStatus: s })}
                    className={`rounded-full border px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition ${
                      store.incidentStatus === s
                        ? STATUS_STYLES[s]
                        : 'border-white/10 text-white/30 hover:border-white/20 hover:text-white/50'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </FieldRow>

          </div>
        </section>
      </div>

      {/* ICS / NIMS Org Chart */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">
            ICS / NIMS Organizational Structure
          </h3>
          <span className="text-[9px] text-white/20">
            Click any field to assign personnel
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-white/8 bg-ink-950/60 px-6 py-5">
          <IcsOrgChart />
        </div>
      </section>

    </div>
  );
}
