import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRiskReportStore } from './riskReportStore';
import { RISK_LEVELS, RISK_RINGS, type RiskLevel, type SectionResult, type WildfireReportData } from './riskTypes';
import { ForecastStrip, MapFigure, WindChart } from './reportVisuals';
import { usePrintStyles } from '../lib/printStyles';

// ── Property wildfire risk report (roadmap Track 3, wildfire end-to-end) ─────
// Select property → the assembly cross-references every wildfire input at the
// fixed analysis rings → this renderer. Mirrors the archive report's look and
// prints through the same shared print pipeline.

function fmtTs(iso: string) {
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }); }
  catch { return iso; }
}

function LevelBadge({ level, size = 'md' }: { level: RiskLevel; size?: 'md' | 'lg' }) {
  const def = RISK_LEVELS[level];
  return (
    <span
      className={`print-color inline-flex items-center gap-1.5 rounded-full border font-bold uppercase tracking-widest ${
        size === 'lg' ? 'px-3 py-1 text-[12px]' : 'px-2 py-0.5 text-[9px]'
      }`}
      style={{ color: def.color, background: `${def.color}1c`, borderColor: `${def.color}55` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: def.color }} />
      {def.label}
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="print-card rounded-lg border border-white/8 bg-white/4 px-3.5 py-3">
      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/35 print-muted">{label}</div>
      <div className="mt-1 text-[15px] font-semibold text-white/85">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-white/40 print-muted">{sub}</div>}
    </div>
  );
}

function Section({ section, children }: { section: SectionResult; children?: React.ReactNode }) {
  return (
    <section className="print-card">
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">{section.title}</h2>
        {section.unavailable ? (
          <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/40">
            Unavailable
          </span>
        ) : (
          <LevelBadge level={section.level} />
        )}
      </div>
      {section.unavailable ? (
        <p className="rounded-lg border border-white/8 bg-white/4 px-4 py-3 text-[12px] text-white/45">{section.unavailable}</p>
      ) : (
        <>
          {section.drivers.length > 0 && (
            <ul className="mb-2 space-y-0.5 text-[12px] text-white/70">
              {section.drivers.map((d, i) => (
                <li key={i}>· {d}</li>
              ))}
            </ul>
          )}
          {children}
        </>
      )}
    </section>
  );
}

const num = (v: number | undefined, digits = 0) =>
  v === undefined || Number.isNaN(v) ? '—' : v.toFixed(digits);

function ReportBody({ data }: { data: WildfireReportData }) {
  const overall = RISK_LEVELS[data.overall.level];
  const nearestHotspot = data.hotspots[0];
  const worstAlert = data.alerts[0];

  const byId = (id: string) => data.sections.find((s) => s.id === id);

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-8 py-8">
      {/* BLUF */}
      <section
        className="print-card rounded-xl border p-5"
        style={{ borderColor: `${overall.color}55`, background: `${overall.color}0d` }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <LevelBadge level={data.overall.level} size="lg" />
          <span className="text-[14px] font-semibold text-white/90">Wildfire risk — {data.target.name}</span>
        </div>
        <ul className="mt-3 space-y-1 text-[12px] leading-snug text-white/75">
          {data.overall.drivers.length === 0 ? (
            <li>No wildfire indicators near this property in any monitored feed.</li>
          ) : (
            data.overall.drivers.map((d, i) => <li key={i}>· {d}</li>)
          )}
        </ul>
      </section>

      {/* Hero exposure map: every ring, hotspot, and named incident at once */}
      <MapFigure
        src={data.maps.exposure}
        caption={`Exposure map — analysis rings (${RISK_RINGS.map((r) => r.label).join(' / ')}), VIIRS hotspots (sized by fire radiative power), named incidents (colored by containment)`}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Nearest hotspot"
          value={nearestHotspot ? `${num(nearestHotspot.distanceMi, 1)} mi` : 'None ≤100 mi'}
          sub={nearestHotspot?.frp !== undefined ? `FRP ${num(nearestHotspot.frp)} MW` : undefined}
        />
        <StatCard
          label="Fire alerts at site"
          value={data.alerts.length === 0 ? 'None' : String(data.alerts.length)}
          sub={worstAlert?.event}
        />
        <StatCard
          label="7-day outlook"
          value={data.outlook.today ?? '—'}
          sub={data.outlook.unavailable ? 'unavailable' : 'today, this PSA'}
        />
        <StatCard
          label="Fuel potential"
          value={data.fuel.score !== undefined ? `${data.fuel.score}/100` : '—'}
          sub={data.fuel.level ?? data.fuel.unavailable}
        />
        <StatCard
          label="Wind"
          value={data.wind.nowMph !== undefined ? `${num(data.wind.nowMph)} mph` : '—'}
          sub={
            data.wind.peakGust48Mph !== undefined
              ? `48 h peak gust ${num(data.wind.peakGust48Mph)} mph`
              : data.wind.unavailable
          }
        />
      </div>

      {/* Ring exposure */}
      <section className="print-card">
        <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">Exposure by analysis ring</h2>
        <div className="overflow-x-auto rounded-lg border border-white/8 bg-white/4">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-white/10 text-left text-[9px] font-bold uppercase tracking-wider text-white/35">
                <th className="px-3 py-2">Ring</th>
                <th className="px-3 py-2">Meaning</th>
                <th className="px-3 py-2 text-right">Hotspots</th>
                <th className="px-3 py-2 text-right">Named fires</th>
              </tr>
            </thead>
            <tbody>
              {data.ringCounts.map((r) => (
                <tr key={r.ring.id} className="border-b border-white/5 text-white/70 last:border-0">
                  <td className="px-3 py-1.5 font-semibold">{r.ring.label}</td>
                  <td className="px-3 py-1.5 text-white/45">{r.ring.meaning}</td>
                  <td className="px-3 py-1.5 text-right">{r.hotspots}</td>
                  <td className="px-3 py-1.5 text-right">{r.namedFires}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Hotspots */}
      {byId('hotspots') && (
        <Section section={byId('hotspots')!}>
          {data.hotspots.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-white/8 bg-white/4">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-white/10 text-left text-[9px] font-bold uppercase tracking-wider text-white/35">
                    <th className="px-3 py-2">Distance</th>
                    <th className="px-3 py-2">FRP</th>
                    <th className="px-3 py-2">Satellite</th>
                    <th className="px-3 py-2">Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {data.hotspots.map((h, i) => (
                    <tr key={i} className="border-b border-white/5 text-white/70 last:border-0">
                      <td className="px-3 py-1.5">{num(h.distanceMi, 1)} mi</td>
                      <td className="px-3 py-1.5">{h.frp !== undefined ? `${num(h.frp)} MW` : '—'}</td>
                      <td className="px-3 py-1.5">{h.satellite ?? '—'}</td>
                      <td className="px-3 py-1.5">{h.ageHours !== undefined ? `${num(h.ageHours)} h ago` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {/* Named fires */}
      {byId('named-fires') && (
        <Section section={byId('named-fires')!}>
          {data.namedFires.length > 0 && (
            <div className="space-y-1.5">
              {data.namedFires.map((f, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-[12px] text-white/75">
                  <span className="font-semibold">{f.name}</span>
                  <span className="text-white/45">{num(f.distanceMi, 1)} mi</span>
                  {f.acres !== undefined && <span className="text-white/45">{Math.round(f.acres).toLocaleString()} acres</span>}
                  <span className="ml-auto text-white/45">
                    {f.containmentPct !== undefined ? `${num(f.containmentPct)}% contained` : 'containment unknown'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Alerts / Outlook / Fuel / Wind sections */}
      {(['alerts', 'outlook', 'fuel', 'wind'] as const).map((id) => {
        const s = byId(id);
        if (!s) return null;
        return (
          <Section key={id} section={s}>
            {id === 'alerts' && data.alerts.length > 0 && (
              <div className="space-y-1.5">
                {data.alerts.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-[12px] text-white/75">
                    <span className="font-semibold">{a.event}</span>
                    {a.severity && <span className="text-white/45">{a.severity}</span>}
                    {a.expires && <span className="ml-auto text-white/45">until {fmtTs(a.expires)}</span>}
                  </div>
                ))}
                <MapFigure src={data.maps.alerts} caption="Active fire-weather alert areas over the property (NWS polygons / county shapes)" />
              </div>
            )}
            {id === 'fuel' && (
              <div className="space-y-2">
                {data.fuel.topModels && data.fuel.topModels.length > 0 && (
                  <div className="space-y-1">
                    {data.fuel.topModels.map((m) => (
                      <div key={m.code} className="flex items-center gap-2 text-[11px] text-white/60">
                        <span className="w-10 font-mono text-white/80">{m.code}</span>
                        <span className="min-w-0 flex-1 truncate">{m.name}</span>
                        <span>{num(m.pct, 1)}%</span>
                      </div>
                    ))}
                  </div>
                )}
                <MapFigure src={data.maps.fuel} caption="LANDFIRE FBFM40 fuel models (30 m) around the property — official colormap, 3 mi analysis ring" />
              </div>
            )}
            {id === 'wind' && data.windHourly && <WindChart hourly={data.windHourly} />}
          </Section>
        );
      })}

      {/* Forecast rainfall — 24/48/72 h accumulation */}
      {(data.maps.qpf24 || data.maps.qpf48 || data.maps.qpf72) && (
        <section className="print-card">
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">
            Forecast rainfall (WPC accumulation)
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MapFigure src={data.maps.qpf24} caption="Next 24 h" />
            <MapFigure src={data.maps.qpf48} caption="Next 48 h" />
            <MapFigure src={data.maps.qpf72} caption="Next 72 h" />
          </div>
          <p className="mt-1.5 text-[9px] text-white/30 print-muted">
            Official WPC color ramp · dashed ring = 25 mi · rain on fuels beats any suppression asset
          </p>
        </section>
      )}

      {/* 10-day forecast strip */}
      <section className="print-card">
        <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">10-day forecast</h2>
        {'days' in data.forecastDaily ? (
          <ForecastStrip forecast={data.forecastDaily} />
        ) : (
          <p className="rounded-lg border border-white/8 bg-white/4 px-4 py-3 text-[12px] text-white/45">
            {data.forecastDaily.unavailable}
          </p>
        )}
      </section>

      {/* Sources + gaps */}
      <section className="print-card border-t border-white/8 pt-4">
        <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">Sources</h2>
        <ul className="space-y-0.5 text-[10px] text-white/40 print-muted">
          {data.sources.map((s, i) => (
            <li key={i}><span className="text-white/60">{s.name}</span> — {s.detail}</li>
          ))}
        </ul>
        {data.gaps.length > 0 && (
          <p className="mt-3 text-[10px] leading-relaxed text-white/30 print-muted">
            Not yet factored: {data.gaps.join(' · ')}
          </p>
        )}
        <p className="mt-3 text-center text-[9px] text-white/25 print-muted">
          Generated {fmtTs(data.generatedAt)} · fixed analysis rings ({RISK_RINGS.map((r) => r.label).join(' / ')}) · advisory product, verify against official sources before acting
        </p>
      </section>
    </main>
  );
}

export function RiskReportView() {
  const { target, status, data, error, close } = useRiskReportStore();
  usePrintStyles('risk-report-root');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [close]);

  if (!target) return null;

  const modal = (
    <div className="risk-report-root fixed inset-0 z-[3000] overflow-y-auto bg-ink-950 text-white">
      {/* Top bar — hidden when printing */}
      <div className="print-hide sticky top-0 z-10 flex items-center gap-4 border-b border-white/8 bg-ink-900/90 px-8 py-3 backdrop-blur-sm">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/30">Property Risk Report · Wildfire</p>
          <p className="text-[15px] font-semibold text-white/85">
            {target.groupIcon} {target.name}
            {target.groupName && <span className="ml-2 text-[11px] text-white/40">{target.groupName}</span>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {status === 'ready' && (
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded border border-accent/30 bg-accent/8 px-3 py-1.5 text-[11px] text-accent transition hover:border-accent/50 hover:bg-accent/18"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              Print / Save as PDF
            </button>
          )}
          <button
            onClick={close}
            className="flex items-center gap-1.5 rounded border border-white/12 px-3 py-1.5 text-[11px] text-white/50 transition hover:border-white/22 hover:text-white"
          >
            ✕ Close
          </button>
        </div>
      </div>

      {status === 'loading' && (
        <div className="flex h-[60vh] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
            <p className="mt-3 text-[12px] text-white/40">Cross-referencing wildfire feeds around {target.name}…</p>
          </div>
        </div>
      )}
      {status === 'error' && (
        <div className="flex h-[60vh] items-center justify-center">
          <p className="text-[13px] text-white/50">{error ?? 'Could not assemble the report.'}</p>
        </div>
      )}
      {/* Table wrap: in print the thead repeats the page header on every page
          (reserving its space); on screen everything is display:block. */}
      <table className="print-page-table block w-full">
        <thead className="print-page-thead block">
          <tr className="block">
            <td className="block">
              <div className="print-page-header hidden">
                <span className="font-bold uppercase tracking-widest">GSOC Monitor · Property Risk Report</span>
                <span>{target.name} — Wildfire</span>
                <span className="ml-auto">Generated {new Date().toLocaleString()}</span>
              </div>
            </td>
          </tr>
        </thead>
        <tbody className="print-page-tbody block">
          <tr className="block">
            <td className="block">
              {status === 'ready' && data && <ReportBody data={data} />}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  return createPortal(modal, document.body);
}
