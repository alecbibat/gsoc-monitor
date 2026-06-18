// Centred ops-console status bar for the auth screen.
// Shows "VIRTUAL WAR ROOM", a live operational summary, the named subsystems,
// and the deployment timestamp. Rendered in-flow (centred) under the form.

const BUILD_ISO: string =
  typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : new Date().toISOString();

const SYSTEMS: [string, boolean][] = [
  ['Crisis Management',   true],
  ['Earthquake Monitor',  true],
  ['Flight Tracking',     true],
  ['Maritime Tracking',   true],
  ['Weather Radar',       true],
  ['Satellite Tracking',  true],
  ['Lightning Detection', true],
  ['Hurricane Tracking',  true],
  ['Fire Detection',      true],
  ['News Intelligence',   true],
];

function fmtDeploy(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
  });
  return { date, time };
}

const operational = SYSTEMS.filter(([, up]) => up).length;

function Divider() {
  return <span className="hidden h-3 w-px bg-accent/15 sm:block" />;
}

export function StatusPanel() {
  const { date, time } = fmtDeploy(BUILD_ISO);

  return (
    <div
      className="select-none rounded-xl border border-accent/10 bg-ink-950/55 px-4 py-2.5 shadow-[0_0_0_1px_rgba(61,220,255,0.05),0_8px_40px_rgba(0,0,0,0.55)] backdrop-blur-md"
      aria-hidden="true"
    >
      {/* Summary row */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-2">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-ok opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-ok" />
          </span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-white/70">
            Virtual War Room
          </span>
        </span>
        <Divider />
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-accent-ok/70">
          {operational}/{SYSTEMS.length} Systems Operational
        </span>
        <Divider />
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/35">
          Last Deploy <span className="text-accent/60">{date} · {time}</span>
        </span>
      </div>

      {/* Subsystem chips */}
      <div className="mt-2 hidden flex-wrap items-center justify-center gap-x-3.5 gap-y-1.5 border-t border-white/6 pt-2 sm:flex">
        {SYSTEMS.map(([name, up]) => (
          <span key={name} className="flex items-center gap-1.5">
            <span
              className={`h-[5px] w-[5px] shrink-0 rounded-full ${
                up ? 'bg-accent-ok shadow-[0_0_4px_rgba(82,227,164,0.6)]' : 'bg-accent-danger'
              }`}
            />
            <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-white/40">
              {name}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
