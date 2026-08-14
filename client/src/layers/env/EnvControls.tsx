import { useEnvStore, type EnvField } from './envStore';

// Field picker for the surface-field overlay (shown when the layer is on).
const FIELDS: Array<{ id: EnvField; label: string }> = [
  { id: 'temp', label: 'Temperature' },
  { id: 'rh', label: 'Humidity' },
];

export function EnvControls() {
  const field = useEnvStore((s) => s.field);
  const setField = useEnvStore((s) => s.setField);
  return (
    <div className="mt-1.5 flex gap-1">
      {FIELDS.map((f) => (
        <button
          key={f.id}
          onClick={() => setField(f.id)}
          className={`rounded border px-2 py-0.5 text-[10px] transition ${
            field === f.id
              ? 'border-accent/40 bg-accent/15 text-accent'
              : 'border-white/10 text-white/40 hover:text-white/70'
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
