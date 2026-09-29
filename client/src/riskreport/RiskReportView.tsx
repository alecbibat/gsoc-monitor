import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRiskReportStore } from './riskReportStore';
import { RISK_LEVELS, RISK_RINGS, type WildfireReportData } from './riskTypes';
import { ChipStrip, ForecastStrip, LegendRow, MapFigure, OutlookStrip, WindChart } from './reportVisuals';
import { FUEL_GROUPS, rgbCss } from '../layers/fuel/fbfm40';
import { OUTLOOK_LEGEND } from '../layers/fireOutlook/fireOutlookMeta';
import { LevelBadge, QpfRampLegend, Section, SourcesFooter, StatCard, fmtTs, num, rainCells } from './reportParts';
import { LEGEND_ITEMS as LIGHTNING_LEGEND } from '../layers/lightning/lightningPalette';
import { coverageCaption, lightningCountPrefix } from './lightningSection';
import { usePrintStyles } from '../lib/printStyles';
import { RiskScanLoading } from './RiskScanLoading';
import { FloodReportBody } from './FloodReportBody';
import type { RiskHazard } from './riskReportStore';

const HAZARD_LABEL: Record<RiskHazard, string> = { wildfire: 'Wildfire', flood: 'Flood' };

// Plumes are drawn as hatching + outlines so the satellite imagery (the smoke
// itself) stays visible — the legend mirrors that with hatched swatches.
const SMOKE_LEGEND = [
  { color: 'rgba(236,222,152,0.95)', label: 'Light smoke', hatch: true },
  { color: 'rgba(245,158,11,0.95)', label: 'Medium', hatch: true },
  { color: 'rgba(220,80,20,1)', label: 'Heavy', hatch: true },
];

// ── Property wildfire risk report (roadmap Track 3, wildfire end-to-end) ─────
// Select property → the assembly cross-references every wildfire input at the
// fixed analysis rings → this renderer. Mirrors the archive report's look and
// prints through the same shared print pipeline.

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
              {data.namedFires.map((f, i) => {
                const ageH = f.updatedAt ? (Date.now() - f.updatedAt) / 3600_000 : null;
                const stale = ageH !== null && ageH >= 24;
                return (
                  <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-[12px] text-white/75">
                    <span className="font-semibold">{f.name}</span>
                    <span className="text-white/45">{num(f.distanceMi, 1)} mi</span>
                    {f.acres !== undefined && <span className="text-white/45">{Math.round(f.acres).toLocaleString()} acres</span>}
                    <span className="ml-auto text-white/45">
                      {f.containmentPct !== undefined ? `${num(f.containmentPct)}% contained` : 'containment unknown'}
                    </span>
                    <span
                      className={`print-color w-full text-[10px] sm:w-auto ${stale ? 'font-semibold text-amber-300' : 'text-white/35'}`}
                      style={stale ? { color: '#fcd34d' } : undefined}
                      title={f.updatedAt ? new Date(f.updatedAt).toLocaleString() : undefined}
                    >
                      {ageH === null
                        ? 'update time unknown'
                        : stale
                          ? `⚠ updated ${Math.round(ageH)} h ago`
                          : `updated ${ageH < 1 ? '<1' : Math.round(ageH)} h ago`}
                    </span>
                  </div>
                );
              })}
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
            {id === 'outlook' && (
              <div className="space-y-2">
                {data.outlook.days && <OutlookStrip days={data.outlook.days} />}
                <MapFigure
                  src={data.maps.outlook}
                  caption={`Regional significant fire potential — today${data.outlook.days?.[0] ? ` (${data.outlook.days[0].label} at the site)` : ''} · white outline = this property's Predictive Service Area`}
                />
                {data.maps.outlook && (
                  <LegendRow items={OUTLOOK_LEGEND.map((l) => ({ color: l.hex, label: l.label }))} />
                )}
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
                {data.maps.fuel && (
                  <LegendRow items={FUEL_GROUPS.map((g) => ({ color: rgbCss(g.rgb), label: g.label }))} />
                )}
              </div>
            )}
            {id === 'wind' && data.windHourly && <WindChart hourly={data.windHourly} />}
          </Section>
        );
      })}

      {/* Smoke — latest HD satellite view (GIBS MODIS) with HMS plumes.
          The satellite image doesn't depend on the HMS feed, so it still
          renders below the honest "unavailable" note when HMS is down. */}
      {byId('smoke') && (
        <>
          <Section section={byId('smoke')!}>
            <div className="space-y-2">
              <MapFigure
                src={data.maps.smoke}
                caption={`MODIS Aqua true color, ${data.smoke.imageryDate ?? 'latest complete day'}${data.smoke.analysisDate ? ` · HMS plumes hatched by density, analysis ${data.smoke.analysisDate}` : ''} — the imagery beneath the hatching is the smoke itself · dashed ring = 25 mi`}
              />
              {data.maps.smoke && <LegendRow items={SMOKE_LEGEND} />}
            </div>
          </Section>
          {byId('smoke')!.unavailable && data.maps.smoke && (
            <MapFigure
              src={data.maps.smoke}
              caption={`MODIS Aqua true color, ${data.smoke.imageryDate ?? 'latest complete day'} — smoke overlay unavailable, satellite view only · dashed ring = 25 mi`}
            />
          )}
        </>
      )}

      {/* Lightning — 24 h of strikes as X marks in the globe's age ramp */}
      {byId('lightning') && (
        <Section section={byId('lightning')!}>
          <div className="space-y-2">
            <MapFigure
              src={data.maps.lightning}
              caption={[
                `Lightning strikes, past 24 h — X marks colored by age, rings at 25 / 100 mi${
                  data.lightning.strikes100mi !== undefined
                    ? ` · ${lightningCountPrefix(data.lightning)}${data.lightning.strikes100mi.toLocaleString()} within 100 mi`
                    : ''
                }`,
                data.lightning.mapNote,
                coverageCaption(data.lightning.coverage),
              ]
                .filter(Boolean)
                .join(' · ')}
            />
            {data.maps.lightning && <LegendRow items={LIGHTNING_LEGEND} />}
          </div>
        </Section>
      )}

      {/* Forecast rainfall — site totals summarized above one regional map */}
      {data.maps.qpf && (
        <section className="print-card">
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">
            Forecast rainfall (WPC accumulation)
          </h2>
          <div className="space-y-2">
            {!data.rain.unavailable && rainCells(data.rain).length > 0 && (
              <ChipStrip cells={rainCells(data.rain)} />
            )}
            <MapFigure
              src={data.maps.qpf}
              caption="Regional accumulation over the next 72 h — official WPC color ramp · dashed ring = 25 mi"
            />
            {data.maps.qpf && <QpfRampLegend />}
          </div>
          <p className="mt-1.5 text-[9px] text-white/30 print-muted">
            {data.rain.source === 'wpc'
              ? 'Chips are the WPC forecast at the property point — the same product the map renders'
              : 'Chips approximated from the daily point forecast (calendar days) — may differ from the WPC map'}
            {' '}· rain on fuels beats any suppression asset
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

      <SourcesFooter sources={data.sources} gaps={data.gaps} generatedAt={data.generatedAt} />
    </main>
  );
}

export function RiskReportView() {
  const { target, hazard, status, data, error, close, feeds } = useRiskReportStore();
  usePrintStyles('risk-report-root');

  // Exit beat: hold the acquisition screen briefly once assembly finishes so
  // the console is seen reaching 12/12 before the report fades in — a hard
  // cut mid-animation reads as a glitch, not a completion.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (status !== 'ready') { setSettled(false); return; }
    const id = window.setTimeout(() => setSettled(true), 450);
    return () => window.clearTimeout(id);
  }, [status]);

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
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/30">Property Risk Report · {HAZARD_LABEL[hazard]}</p>
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

      {(status === 'loading' || (status === 'ready' && !settled)) && (
        <RiskScanLoading target={target} hazard={hazard} feeds={feeds} />
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
                <span>{target.name} — {HAZARD_LABEL[hazard]}</span>
                <span className="ml-auto">Generated {new Date().toLocaleString()}</span>
              </div>
            </td>
          </tr>
        </thead>
        <tbody className="print-page-tbody block">
          <tr className="block">
            <td className="block">
              {status === 'ready' && settled && data && (
                <div className="watch-ledger-in">
                  {data.hazard === 'flood' ? <FloodReportBody data={data} /> : <ReportBody data={data} />}
                </div>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  return createPortal(modal, document.body);
}
