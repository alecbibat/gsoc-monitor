import { useEffect, useRef, useState } from 'react';

// DEFCON levels 1-5: 1 is most severe ("nuclear war"), 5 is normal peacetime.
// This is a NOVELTY gauge that aggregates publicly available indicators:
// active NWS extreme/severe alerts, USGS M6+ earthquakes in the last 24h,
// and NHC tropical storm advisories. It is NOT affiliated with or indicative
// of actual US military readiness.
const DEFCON_DEFS = [
  { level: 1, label: 'MAXIMUM FORCE READINESS', color: '#ff1744', description: 'Civilization-threatening event. Nuclear war imminent.' },
  { level: 2, label: 'ARMED FORCES READY', color: '#ff6d00', description: 'Armed forces ready to deploy and engage in less than 6 hours.' },
  { level: 3, label: 'ABOVE NORMAL READINESS', color: '#ffd600', description: 'Air Force ready to mobilise in 15 minutes.' },
  { level: 4, label: 'INCREASED INTELLIGENCE', color: '#76ff03', description: 'Above normal preparedness — increased vigilance.' },
  { level: 5, label: 'LOWEST STATE OF READINESS', color: '#00e5ff', description: 'Normal peacetime readiness.' },
] as const;

interface AlertData {
  features: Array<{ properties: { severity: string; event: string } }>;
}

interface EqData {
  features: Array<{ properties: { mag: number; time: number } }>;
}

const SEVERE_EVENTS = ['Tornado Warning', 'Tsunami Warning', 'Flash Flood Emergency', 'Hurricane Warning', 'Storm Surge Warning', 'Extreme Wind Warning'];

async function computeLevel(): Promise<{ level: number; factors: string[] }> {
  const factors: string[] = [];
  let score = 0; // higher = more severe

  // --- NWS Alerts ---
  try {
    const r = await fetch('https://api.weather.gov/alerts/active?status=actual');
    if (r.ok) {
      const json = (await r.json()) as AlertData;
      const features = json.features ?? [];
      const extreme = features.filter((f) => f.properties.severity === 'Extreme');
      const severe = features.filter((f) => f.properties.severity === 'Severe');
      const lifeThreat = features.filter((f) => SEVERE_EVENTS.some((ev) => f.properties.event?.includes(ev.split(' ')[0])));

      if (lifeThreat.length > 0) { score += 3; factors.push(`${lifeThreat.length} life-threatening NWS alert${lifeThreat.length > 1 ? 's' : ''}`); }
      else if (extreme.length > 0) { score += 2; factors.push(`${extreme.length} Extreme NWS alert${extreme.length > 1 ? 's' : ''}`); }
      else if (severe.length > 5) { score += 1; factors.push(`${severe.length} Severe NWS alerts`); }
    }
  } catch { /* non-critical */ }

  // --- USGS Earthquakes M6+ in last 24h ---
  try {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const r = await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=6&starttime=${since}`);
    if (r.ok) {
      const json = (await r.json()) as EqData;
      const count = json.features?.length ?? 0;
      const hasM7 = json.features?.some((f) => f.properties.mag >= 7) ?? false;
      if (hasM7) { score += 2; factors.push(`M7+ earthquake in last 24h`); }
      else if (count > 0) { score += 1; factors.push(`${count} M6+ earthquake${count > 1 ? 's' : ''} in last 24h`); }
    }
  } catch { /* non-critical */ }

  // Map score → DEFCON (5=normal, 1=worst)
  let level: number;
  if (score >= 6) level = 1;
  else if (score >= 4) level = 2;
  else if (score >= 3) level = 3;
  else if (score >= 1) level = 4;
  else level = 5;

  if (factors.length === 0) factors.push('No significant events detected');
  return { level, factors };
}

export function DefconWidget() {
  const [level, setLevel] = useState(5);
  const [factors, setFactors] = useState<string[]>(['Calculating…']);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const load = async () => {
      const result = await computeLevel();
      if (cancelledRef.current) return;
      setLevel(result.level);
      setFactors(result.factors);
      setLoading(false);
    };
    load();
    const id = setInterval(load, 3 * 60_000);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, []);

  const def = DEFCON_DEFS.find((d) => d.level === level) ?? DEFCON_DEFS[4];

  return (
    <div className="space-y-4">
      {/* Big readout */}
      <div className="rounded-xl border py-6 text-center" style={{ borderColor: `${def.color}30`, background: `${def.color}10` }}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.3em]" style={{ color: `${def.color}99` }}>
          DEFCON
        </div>
        <div
          className="my-1 text-[80px] font-black leading-none tabular-nums"
          style={{ color: def.color, textShadow: `0 0 40px ${def.color}80` }}
        >
          {loading ? '…' : level}
        </div>
        <div className="text-[11px] font-semibold tracking-widest" style={{ color: def.color }}>
          {def.label}
        </div>
      </div>

      <p className="text-[12px] leading-snug text-white/60">{def.description}</p>

      {/* Live indicators */}
      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/30">
          Active indicators
        </div>
        <ul className="space-y-1">
          {factors.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px] text-white/70">
              <span style={{ color: def.color }} className="mt-0.5 shrink-0">▸</span>
              {f}
            </li>
          ))}
        </ul>
      </div>

      {/* Level strip */}
      <div className="flex gap-1">
        {DEFCON_DEFS.slice().reverse().map((d) => (
          <div
            key={d.level}
            className="flex flex-1 flex-col items-center gap-0.5 rounded px-1 py-1.5 text-[10px] font-bold"
            style={{
              background: d.level === level ? `${d.color}20` : 'transparent',
              color: d.level === level ? d.color : `${d.color}50`,
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: d.level === level ? `${d.color}60` : 'transparent',
            }}
          >
            {d.level}
          </div>
        ))}
      </div>

      <p className="text-[10px] leading-snug text-white/25">
        ⚠ Novelty indicator only. Not affiliated with the US military or any government agency.
        Derived from publicly available NWS and USGS data.
      </p>
    </div>
  );
}
