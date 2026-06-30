import type { GroupStatus, StatusLevel } from './dashboardData';

const LEVEL: Record<StatusLevel, { ring: string; dot: string; text: string; label: string }> = {
  ok: { ring: 'ring-emerald-500/25', dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'OK' },
  watch: { ring: 'ring-amber-400/40', dot: 'bg-amber-400', text: 'text-amber-300', label: 'Watch' },
  alert: { ring: 'ring-red-500/50', dot: 'bg-red-500', text: 'text-red-400', label: 'Alert' },
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

function Metric({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-white/35">{label}</span>
      <span className={`font-medium tabular-nums ${valueClass ?? 'text-white/75'}`}>{value}</span>
    </div>
  );
}

export function DashboardCard({ s }: { s: GroupStatus }) {
  const lv = LEVEL[s.level];
  return (
    <div className={`rounded-xl border border-white/10 bg-ink-900/70 p-3 ring-1 ${lv.ring}`}>
      <div className="flex items-center gap-2">
        <span className="text-lg leading-none">{s.group.icon}</span>
        <span className="flex-1 truncate text-[13px] font-semibold text-white/90">{s.group.name}</span>
        <span className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide ${lv.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${lv.dot}`} />
          {lv.label}
        </span>
      </div>

      {s.alerts.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {s.alerts.slice(0, 2).map((a) => (
            <div key={a.id} className="flex items-center gap-1.5 text-[11px]">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: a.colorHex }} />
              <span className="truncate text-white/75">{a.event}</span>
            </div>
          ))}
          {s.alerts.length > 2 && (
            <div className="pl-3.5 text-[10px] text-white/40">+{s.alerts.length - 2} more</div>
          )}
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <Metric label="Weather" value={s.weather ? `${s.weather.tempF}°F · ${s.weather.windKt}kt` : '—'} />
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
          value={s.nearestQuake ? `M${s.nearestQuake.mag.toFixed(1)}·${s.nearestQuake.mi.toFixed(0)}mi` : 'none'}
        />
        <Metric label="News" value={s.news.count ? `${s.news.count} nearby` : 'none'} />
      </div>
    </div>
  );
}
