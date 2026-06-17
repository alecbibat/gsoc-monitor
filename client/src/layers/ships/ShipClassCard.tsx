interface ShipProfile {
  class: 'STAR CLASS' | 'WIND CLASS';
  built: number;
  refitted?: number;
  lengthM: number;
  beamM: number;
  grt: number;
  guests: number;
  crew: number;
  speedKt: number;
  sailSpeedKt?: number;
  masts?: number;
  sails?: number;
  iceClass?: boolean;
}

// Keyed by MMSI — matches the FLEET definition in server/src/routes/ships.ts
const PROFILES: Record<string, ShipProfile> = {
  // Star class — motor yachts refitted 2020–2021 (Star Plus initiative)
  '311083000': { class: 'STAR CLASS', built: 1989, refitted: 2020, lengthM: 159, beamM: 19.2, grt: 12_995, guests: 312, crew: 190, speedKt: 18 }, // Star Breeze
  '311085000': { class: 'STAR CLASS', built: 1992, refitted: 2021, lengthM: 159, beamM: 19.2, grt: 12_995, guests: 312, crew: 190, speedKt: 18 }, // Star Legend
  '311084000': { class: 'STAR CLASS', built: 1988, refitted: 2020, lengthM: 159, beamM: 19.2, grt: 12_995, guests: 312, crew: 190, speedKt: 18 }, // Star Pride
  '311001759': { class: 'STAR CLASS', built: 2025, lengthM: 131.5, beamM: 19, grt: 9_315, guests: 224, crew: 135, speedKt: 16, iceClass: true }, // Star Seeker
  // Wind class — original sailing vessels
  '309056000': { class: 'WIND CLASS', built: 1988, lengthM: 110, beamM: 15.8, grt: 5_376, guests: 148, crew: 88, speedKt: 12, sailSpeedKt: 15, masts: 4, sails: 5 }, // Wind Spirit
  '309163000': { class: 'WIND CLASS', built: 1986, lengthM: 110, beamM: 15.8, grt: 5_307, guests: 148, crew: 88, speedKt: 12, sailSpeedKt: 15, masts: 4, sails: 5 }, // Wind Star
  '309242000': { class: 'WIND CLASS', built: 1990, lengthM: 187, beamM: 20, grt: 14_745, guests: 342, crew: 191, speedKt: 12, sailSpeedKt: 15, masts: 5, sails: 7 }, // Wind Surf
};

const STAR_COLOR = '#38bdf8';
const WIND_COLOR = '#fbbf24';

// Side-profile wireframe of a multi-deck motor cruise ship (Star class).
function StarWireframe({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 168 68" width="168" height="68" aria-hidden>
      {/* Hull underbody */}
      <path d="M14,46 Q8,54 20,60 L150,60 Q162,58 160,46" stroke={color} fill="none" strokeWidth="1.4" />
      {/* Stern overhang */}
      <path d="M14,46 L6,52 L20,60" stroke={color} fill="none" strokeWidth="1.4" />
      {/* Bow flare */}
      <path d="M160,46 L166,50 L150,60" stroke={color} fill="none" strokeWidth="1.4" />
      {/* Waterline */}
      <line x1="6" y1="46" x2="166" y2="46" stroke={color} strokeWidth="1" opacity="0.5" />
      {/* Deck 1 (main) */}
      <rect x="24" y="36" width="124" height="10" stroke={color} fill="none" strokeWidth="1.3" />
      {/* Deck 2 */}
      <rect x="38" y="27" width="96" height="9" stroke={color} fill="none" strokeWidth="1.2" />
      {/* Deck 3 */}
      <rect x="52" y="19" width="68" height="8" stroke={color} fill="none" strokeWidth="1.1" />
      {/* Bridge / wheelhouse */}
      <rect x="62" y="12" width="30" height="7" stroke={color} fill="none" strokeWidth="1" />
      {/* Funnel */}
      <path d="M112,27 L109,15 L115,15 L112,27" stroke={color} fill="none" strokeWidth="1.2" />
      <ellipse cx="112" cy="14" rx="4" ry="1.8" stroke={color} fill="none" strokeWidth="1" />
      {/* Porthole dots on deck 1 */}
      {[40, 55, 70, 85, 100, 115, 130].map((x) => (
        <circle key={x} cx={x} cy="41" r="1.4" stroke={color} fill="none" strokeWidth="0.9" opacity="0.5" />
      ))}
      {/* Radar mast */}
      <line x1="72" y1="12" x2="72" y2="6" stroke={color} strokeWidth="0.9" />
      <line x1="68" y1="7" x2="76" y2="7" stroke={color} strokeWidth="0.9" />
    </svg>
  );
}

// Side-profile wireframe of a sailing cruise ship with tall masts (Wind class).
function WindWireframe({ color, masts = 4 }: { color: string; masts?: number }) {
  const mastXs = masts === 5
    ? [48, 66, 84, 102, 120]
    : [52, 72, 92, 112];

  return (
    <svg viewBox="0 0 168 72" width="168" height="72" aria-hidden>
      {/* Hull — sleeker, sailing-ship profile */}
      <path d="M16,50 Q10,58 24,64 L148,64 Q160,62 158,50" stroke={color} fill="none" strokeWidth="1.4" />
      {/* Clipper bow */}
      <path d="M158,50 L166,43 L148,64" stroke={color} fill="none" strokeWidth="1.4" />
      {/* Stern */}
      <path d="M16,50 L8,56 L24,64" stroke={color} fill="none" strokeWidth="1.4" />
      {/* Waterline */}
      <line x1="8" y1="50" x2="166" y2="50" stroke={color} strokeWidth="1" opacity="0.5" />
      {/* Single low deck */}
      <rect x="28" y="41" width="116" height="9" stroke={color} fill="none" strokeWidth="1.3" />
      {/* Low bridge structure */}
      <rect x="68" y="34" width="38" height="7" stroke={color} fill="none" strokeWidth="1.1" />
      {/* Masts */}
      {mastXs.map((x, i) => (
        <g key={i}>
          <line x1={x} y1="41" x2={x} y2="2" stroke={color} strokeWidth="1.3" />
          {/* Boom */}
          <line x1={x - 14} y1={8 + i * 2} x2={x + 14} y2={8 + i * 2} stroke={color} strokeWidth="0.9" />
          {/* Stay lines — suggest sails */}
          <line x1={x} y1="41" x2={x - 13} y2={9 + i * 2} stroke={color} strokeWidth="0.7" opacity="0.45" />
          <line x1={x} y1="41" x2={x + 13} y2={9 + i * 2} stroke={color} strokeWidth="0.7" opacity="0.45" />
        </g>
      ))}
    </svg>
  );
}

export function ShipClassCard({ mmsi }: { mmsi: string }) {
  const profile = PROFILES[mmsi];
  if (!profile) return null;

  const isStar = profile.class === 'STAR CLASS';
  const color = isStar ? STAR_COLOR : WIND_COLOR;
  const animId = `ship-rot-${mmsi}`;

  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="rounded-lg border bg-white/3 px-3 py-2.5" style={{ borderColor: `${color}30` }}>
      <style>{`
        @keyframes ${animId} {
          0%   { transform: perspective(260px) rotateY(0deg); }
          100% { transform: perspective(260px) rotateY(360deg); }
        }
        .${animId} { animation: ${animId} 9s linear infinite; }
      `}</style>

      {/* Rotating wireframe */}
      <div className="flex justify-center pb-1">
        <div className={animId} style={{ transformOrigin: 'center' }}>
          {isStar
            ? <StarWireframe color={color} />
            : <WindWireframe color={color} masts={profile.masts} />}
        </div>
      </div>

      {/* Class badge */}
      <div className="mb-2 flex items-center justify-center gap-2">
        <span
          className="rounded px-2 py-0.5 text-[10px] font-bold tracking-[0.15em]"
          style={{ color, background: `${color}18`, border: `1px solid ${color}40` }}
        >
          {profile.class}
        </span>
        {profile.iceClass && (
          <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-cyan-300/80"
            style={{ background: '#22d3ee18', border: '1px solid #22d3ee30' }}>
            ICE CLASS
          </span>
        )}
        {profile.masts && (
          <span className="text-[9px] text-white/30">
            {profile.masts} masts · {profile.sails} sails
          </span>
        )}
      </div>

      {/* Specs grid */}
      <dl className="grid grid-cols-3 gap-x-2 gap-y-1.5 text-center text-[11px]">
        <div>
          <dt className="text-white/35 text-[9px] uppercase tracking-wider">Length</dt>
          <dd className="font-mono text-white/80">{profile.lengthM} m</dd>
        </div>
        <div>
          <dt className="text-white/35 text-[9px] uppercase tracking-wider">Beam</dt>
          <dd className="font-mono text-white/80">{profile.beamM} m</dd>
        </div>
        <div>
          <dt className="text-white/35 text-[9px] uppercase tracking-wider">GRT</dt>
          <dd className="font-mono text-white/80">{fmt(profile.grt)}</dd>
        </div>
        <div>
          <dt className="text-white/35 text-[9px] uppercase tracking-wider">Guests</dt>
          <dd className="font-mono text-white/80">{profile.guests}</dd>
        </div>
        <div>
          <dt className="text-white/35 text-[9px] uppercase tracking-wider">Crew</dt>
          <dd className="font-mono text-white/80">{profile.crew}</dd>
        </div>
        <div>
          <dt className="text-white/35 text-[9px] uppercase tracking-wider">Speed</dt>
          <dd className="font-mono text-white/80">
            {profile.sailSpeedKt ? `${profile.sailSpeedKt} kt` : `${profile.speedKt} kt`}
          </dd>
        </div>
        <div className="col-span-3">
          <dt className="text-white/35 text-[9px] uppercase tracking-wider">Built</dt>
          <dd className="font-mono text-white/80">
            {profile.built}{profile.refitted ? ` · refitted ${profile.refitted}` : ''}
          </dd>
        </div>
      </dl>
    </div>
  );
}
