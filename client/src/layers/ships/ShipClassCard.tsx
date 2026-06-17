import { ShipModel3D } from './ShipModel3D';

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

export function ShipClassCard({ mmsi }: { mmsi: string }) {
  const profile = PROFILES[mmsi];
  if (!profile) return null;

  const isStar = profile.class === 'STAR CLASS';
  const color = isStar ? STAR_COLOR : WIND_COLOR;

  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="rounded-lg border bg-white/3 px-3 py-2.5" style={{ borderColor: `${color}30` }}>
      {/* Rotating 3D wireframe */}
      <div className="flex justify-center pb-1">
        <ShipModel3D variant={isStar ? 'star' : 'wind'} color={color} masts={profile.masts} />
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
