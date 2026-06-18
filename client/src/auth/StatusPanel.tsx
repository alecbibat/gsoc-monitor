// Floating ops-console status panel for the auth screen.
// Shows "VIRTUAL WAR ROOM", all active subsystems, and the deployment timestamp.
// Desktop only — hidden on mobile where screen space is tight.

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

const left  = SYSTEMS.slice(0, 5);
const right = SYSTEMS.slice(5);

export function StatusPanel() {
  const { date, time } = fmtDeploy(BUILD_ISO);

  return (
    <div
      className="pointer-events-none absolute bottom-5 left-5 z-10 hidden w-[340px] select-none rounded-xl border border-accent/10 bg-ink-950/60 px-4 py-3.5 shadow-[0_0_0_1px_rgba(61,220,255,0.05),0_8px_40px_rgba(0,0,0,0.6)] backdrop-blur-md md:block"
      aria-hidden="true"
    >
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-ok opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-ok" />
        </span>
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-white/70">
          Virtual War Room
        </span>
        <div className="flex-1 border-t border-accent/10" />
        <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-accent-ok/60">
          All Systems Go
        </span>
      </div>

      {/* Systems — two columns */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {[left, right].map((col, ci) =>
          col.map(([name, up]) => (
            <div key={`${ci}-${name}`} className="flex items-center gap-1.5">
              <span
                className={`h-[5px] w-[5px] shrink-0 rounded-full ${
                  up ? 'bg-accent-ok shadow-[0_0_4px_rgba(82,227,164,0.6)]'
                     : 'bg-accent-danger'
                }`}
              />
              <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-white/40">
                {name}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Deploy timestamp */}
      <div className="mt-3 flex items-center justify-between border-t border-white/6 pt-2.5">
        <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-white/20">
          Last Deploy
        </span>
        <span className="font-mono text-[9px] text-accent/50">
          {date} · {time}
        </span>
      </div>
    </div>
  );
}
