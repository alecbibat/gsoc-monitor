import type { GroupStatus, StatusLevel } from './dashboardData';
import { assessThreat, threatColor } from './threatScore';

const LEVEL: Record<
  StatusLevel,
  { ring: string; dot: string; text: string; label: string; glow: string; bar: string; pill: string }
> = {
  ok: {
    ring: 'ring-emerald-500/15',
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    label: 'All clear',
    glow: 'from-emerald-500/[0.06]',
    bar: 'from-emerald-400/0 via-emerald-400/50 to-emerald-400/0',
    pill: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20',
  },
  watch: {
    ring: 'ring-amber-400/25',
    dot: 'bg-amber-400',
    text: 'text-amber-300',
    label: 'Watch',
    glow: 'from-amber-500/[0.08]',
    bar: 'from-amber-400/0 via-amber-400/70 to-amber-400/0',
    pill: 'bg-amber-500/10 text-amber-300 ring-amber-400/25',
  },
  alert: {
    ring: 'ring-red-500/40',
    dot: 'bg-red-500',
    text: 'text-red-300',
    label: 'Alert',
    glow: 'from-red-500/[0.11]',
    bar: 'from-red-500/0 via-red-500/80 to-red-500/0',
    pill: 'bg-red-500/15 text-red-300 ring-red-400/30',
  },
};

function aqiTextColor(v: number | undefined): string {
  if (v == null) return 'text-white/70';
  if (v <= 50) return 'text-green-400';
  if (v <= 100) return 'text-yellow-300';
  if (v <= 150) return 'text-orange-400';
  if (v <= 200) return 'text-red-400';
  if (v <= 300) return 'text-purple-400';
  return 'text-rose-400';
}

// 7-day forecast precipitation accumulation (inches) → compact label + a sky
// tint that deepens with heavier totals.
function fmtPrecip(v: number | null): string {
  if (v == null) return '—';
  if (v < 0.005) return '0"';
  return `${v.toFixed(2)}"`;
}
function precipColor(v: number | null): string | undefined {
  if (v == null) return 'text-white/40';
  if (v >= 1) return 'text-sky-300';
  if (v >= 0.1) return 'text-sky-400/80';
  return undefined;
}

function ClockIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

// "expires" is an NWS ISO timestamp → a compact "time remaining" label, flagged
// urgent under 30 min so the card can warn on imminently-ending alerts.
function expiryLabel(expires: string): { text: string; urgent: boolean } | null {
  if (!expires) return null;
  const t = Date.parse(expires);
  if (Number.isNaN(t)) return null;
  const ms = t - Date.now();
  if (ms <= 0) return { text: 'expired', urgent: false };
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return { text: `${mins}m left`, urgent: mins <= 30 };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    const rem = mins % 60;
    return { text: rem ? `${hrs}h ${rem}m left` : `${hrs}h left`, urgent: false };
  }
  return { text: `${Math.round(hrs / 24)}d left`, urgent: false };
}

function Metric({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[12px] text-white/40">{label}</span>
      <span className={`text-[13.5px] font-semibold tabular-nums ${valueClass ?? 'text-white/80'}`}>{value}</span>
    </div>
  );
}

function custShort(n: number | null): string {
  if (n == null) return '?';
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export function DashboardCard({ s, onSelect }: { s: GroupStatus; onSelect?: () => void }) {
  const lv = LEVEL[s.level];
  const threat = assessThreat(s);
  return (
    <div
      onClick={onSelect}
      role={onSelect ? 'button' : undefined}
      title={onSelect ? 'View on the globe' : undefined}
      className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-ink-900/60 shadow-lg shadow-black/20 ring-1 ${lv.ring} transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-ink-900/80 ${onSelect ? 'cursor-pointer' : ''}`}
    >
      {/* status-tinted glow + a soft top accent bar */}
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${lv.glow} to-transparent`} />
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${lv.bar}`} />

      <div className="relative p-4">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl leading-none">{s.group.icon}</span>
          <span className="flex-1 truncate text-[16px] font-semibold tracking-tight text-white">
            {s.group.name}
          </span>
          {threat.score > 0 && (
            <span
              title={threat.reasons.join(' · ') || 'Threat score'}
              className="rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-ink-950"
              style={{ backgroundColor: threatColor(threat.score) }}
            >
              {threat.score}
            </span>
          )}
          <span
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider ring-1 ${lv.pill}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${lv.dot} ${s.level !== 'ok' ? 'animate-pulse' : ''}`} />
            {lv.label}
          </span>
        </div>

        {s.alerts.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {s.alerts.map((a) => {
              const exp = expiryLabel(a.expires);
              return (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded-lg border-l-[3px] bg-white/[0.04] py-1.5 pl-2.5 pr-2.5"
                  style={{ borderColor: a.colorHex }}
                  title={a.headline ?? a.event}
                >
                  <span className="flex-1 truncate text-[13px] font-medium text-white/90">{a.event}</span>
                  {exp && (
                    <span
                      className={`flex shrink-0 items-center gap-1 text-[11px] font-medium tabular-nums ${
                        exp.urgent ? 'text-red-300' : 'text-white/45'
                      }`}
                    >
                      <ClockIcon />
                      {exp.text}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 border-t border-white/5 pt-3 text-[13px]">
          <Metric label="Weather" value={s.weather ? `${s.weather.tempF}°F · ${s.weather.windKt}kt` : '—'} />
          <Metric label="Rain 7d" value={fmtPrecip(s.precip7d)} valueClass={precipColor(s.precip7d)} />
          <Metric
            label="Air"
            value={s.aqi ? `AQI ${s.aqi.value}` : '—'}
            valueClass={s.aqi ? aqiTextColor(s.aqi.value) : 'text-white/40'}
          />
          <Metric
            label="Fire"
            value={s.nearestFireMi != null ? `${s.nearestFireMi.toFixed(0)} mi` : 'none'}
            valueClass={s.nearestFireMi != null && s.nearestFireMi < 25 ? 'text-orange-400' : undefined}
          />
          <Metric
            label="Quake"
            value={s.nearestQuake ? `M${s.nearestQuake.mag.toFixed(1)} · ${s.nearestQuake.mi.toFixed(0)}mi` : 'none'}
          />
          <Metric label="News" value={s.news.count ? `${s.news.count} nearby` : 'none'} />
          <Metric
            label="Outage"
            value={s.outage ? `${custShort(s.outage.customers)} out · ${s.outage.mi.toFixed(0)}mi` : 'none'}
            valueClass={s.outage ? (s.outage.mi < 25 ? 'text-red-400' : 'text-amber-300') : undefined}
          />
        </div>
      </div>
    </div>
  );
}
