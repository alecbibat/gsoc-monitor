import { Fragment } from 'react';
import { catSev } from '../layers/rivers/riverMeta';
import { RISK_LEVELS, RISK_RINGS, type SectionResult } from './riskTypes';
import { ERO_META, type FloodAlertHit, type FloodReportData } from './floodTypes';
import { gaugeStateLabel, gaugeTier } from './floodSections';
import { BlockTitle, LevelBadge, QpfRampLegend, Section, SourcesFooter, StatCard, fmtTs, num, rainCells } from './reportParts';
import { ChipStrip, ForecastStrip, LegendRow, MapFigure } from './reportVisuals';
import {
  BURN_SCAR_LEGEND, CatChip, DischargeChart, ERO_LEGEND, EroStrip, FEMA_LEGEND, GAUGE_LEGEND, GaugeDetailCard,
  OfflineChip, RainLedger, RainTimingChart, dischargeHasData, fmtGaugeValue,
} from './floodVisuals';

// ── Property flood risk report: body ─────────────────────────────────────────
// The flood analog of ReportBody in RiskReportView.tsx — same frame, same
// print pipeline. Sections come from assembleFlood.ts and are looked up by id;
// a missing one is skipped, an unavailable one prints its reason (Section
// handles that). Fail-honest outside the sections too: a stat card or ring
// count whose feed is down reads "—" with the reason, never "None" or 0 —
// absence of coverage is not absence of risk.

const fmtIn = (v: number | undefined): string =>
  v === undefined || !Number.isFinite(v) ? '—' : v < 0.005 ? '0 in' : v < 0.01 ? '<0.01 in' : `${v.toFixed(2)} in`;

// Alert framing chips: the emergency is the one tag that must jump off the page.
const TAG_STYLE: Record<string, { color: string; solid?: boolean }> = {
  'Flash Flood Emergency': { color: RISK_LEVELS.critical.color, solid: true },
  'Damage threat: Considerable': { color: RISK_LEVELS.high.color },
};

function TagChip({ tag }: { tag: string }) {
  const st = TAG_STYLE[tag];
  if (!st) {
    return (
      <span className="rounded-full border border-white/15 bg-white/6 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/60">
        {tag}
      </span>
    );
  }
  return (
    <span
      className="print-color rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
      style={
        st.solid
          ? { color: '#ffffff', background: st.color, borderColor: st.color }
          : { color: st.color, background: `${st.color}1c`, borderColor: `${st.color}55` }
      }
    >
      {tag}
    </span>
  );
}

function AlertCard({ alert: a }: { alert: FloodAlertHit }) {
  const tags = Array.isArray(a.tags) ? a.tags : [];
  const bullets = Array.isArray(a.bullets) ? a.bullets : [];
  return (
    <div className="print-card rounded-lg border border-white/8 bg-white/4 px-3 py-2.5 text-[12px] text-white/75">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-bold text-white/90">{a.event}</span>
        <LevelBadge level={a.level} />
        {a.severity && <span className="text-white/45">{a.severity}</span>}
        {a.expires && <span className="ml-auto text-white/45">{`until ${fmtTs(a.expires)}`}</span>}
      </div>
      {(tags.length > 0 || a.countyResolved) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {a.countyResolved && <TagChip tag="County-level match — confirm the site is in the warned area" />}
          {tags.map((t) => <TagChip key={t} tag={t} />)}
        </div>
      )}
      {a.headline && <p className="mt-1.5 text-[11px] leading-snug text-white/60">{a.headline}</p>}
      {bullets.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] leading-snug">
          {bullets.map((b, i) => (
            <Fragment key={i}>
              <dt className="pt-px text-[9px] font-bold uppercase tracking-wider text-white/40">{b.label}</dt>
              <dd className="text-white/70">{b.text}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}

const Unavailable = ({ children }: { children: string }) => (
  <p className="rounded-lg border border-white/8 bg-white/4 px-4 py-3 text-[12px] text-white/45">{children}</p>
);

const Note = ({ children }: { children: string }) => (
  <p className="mt-1.5 text-[9px] text-white/30 print-muted">{children}</p>
);

export function FloodReportBody({ data }: { data: FloodReportData }) {
  const overall = RISK_LEVELS[data.overall.level];
  const byId = (id: string): SectionResult | undefined => data.sections.find((s) => s.id === id);

  const alertsS = byId('alerts');
  const gaugesS = byId('gauges');
  const femaS = byId('fema');
  const eroS = byId('ero');
  const rainS = byId('rain');
  const antecedentS = byId('antecedent');
  const burnS = byId('burn-scars');
  const dischargeS = byId('discharge');

  // ── Stat cards ────────────────────────────────────────────────────────────

  // FEMA: atSite === null means the service answered with no zone at the
  // point ("Not mapped"); atSite undefined means we never got an answer ("—").
  const femaStat = (() => {
    const site = data.fema.atSite;
    if (site && !data.fema.unavailable) {
      return { value: femaS?.countLabel ?? `Zone ${site.zone}`, sub: site.label };
    }
    const reason = data.fema.unavailable ?? femaS?.unavailable;
    if (site !== undefined) return { value: 'Not mapped', sub: reason };
    return { value: '—', sub: reason ?? 'not assessed' };
  })();

  const alertStat = (() => {
    if (!alertsS || alertsS.unavailable) return { value: '—', sub: alertsS?.unavailable ?? 'not assessed' };
    const county = data.alerts.some((a) => a.countyResolved);
    return {
      value: data.alerts.length === 0 ? 'None' : String(data.alerts.length),
      // Sorted worst first; a county-outline match is never a site fact.
      sub: data.alerts[0] ? `${data.alerts[0].event}${county ? ' · county-level match' : ''}` : undefined,
    };
  })();

  const ring25 = data.ringCounts.find((r) => r.ring.miles === 25);
  const gaugeStat = (() => {
    if (!gaugesS || gaugesS.unavailable) return { value: '—', sub: gaugesS?.unavailable ?? 'not assessed' };
    const flooding = data.gauges
      .filter((g) => g.distanceMi <= 25 && catSev(gaugeTier(g)) >= 2)
      .sort((a, b) => a.distanceMi - b.distanceMi);
    const g = flooding[0];
    if (g) {
      const tier = gaugeTier(g);
      const forecastOnly = catSev(g.cat) < 2;
      return {
        value: `${num(g.distanceMi, 1)} mi`,
        sub: `${g.name} · ${gaugeStateLabel(tier)}${forecastOnly ? ' (forecast)' : ''}`,
      };
    }
    // The display list is capped; the ring counts cover every gauge.
    if (ring25 && (ring25.flooding > 0 || ring25.forecastFlooding > 0)) {
      return { value: '≤25 mi', sub: 'see River gauges below' };
    }
    const n = ring25?.gauges ?? data.gauges.filter((x) => x.distanceMi <= 25 && !x.offline).length;
    const dark = ring25?.offline ?? data.gauges.filter((x) => x.distanceMi <= 25 && x.offline).length;
    // A gauge gone dark is unknown river state — never "no gauge" or "none in flood".
    if (dark > 0) {
      return {
        value: n === 0 ? 'Unknown' : 'None reporting',
        sub: `${dark} not reporting ≤25 mi — river state unknown${n > 0 ? ` · ${n} reporting, none in flood` : ''}`,
      };
    }
    return {
      value: 'None ≤25 mi',
      sub: n === 0 ? 'no NWPS gauge within 25 mi' : `${n} ${n === 1 ? 'gauge' : 'gauges'} within 25 mi, none in flood`,
    };
  })();

  const eroStat = (() => {
    if (data.ero.unavailable || !data.ero.days) {
      return { value: '—', sub: data.ero.unavailable ?? eroS?.unavailable ?? 'not assessed' };
    }
    const d1 = data.ero.days.find((d) => d.day === 1);
    if (!d1 || !(d1.category in ERO_META)) return { value: 'Unknown', sub: 'Day 1 not returned' };
    // Overnight WPC's Day 1 is the tail of the night and "Day 2" is the coming
    // daytime — the card follows whichever the section weighed as imminent.
    const genMs = Date.parse(data.generatedAt);
    const soon = data.ero.days.find(
      (d) => d.day !== 1 && d.category > 0 && typeof d.startMs === 'number' && d.startMs - genMs <= 12 * 3_600_000
    );
    if (soon && soon.category > d1.category) {
      const m = ERO_META[soon.category];
      return { value: m.label, sub: `${m.prob} probability · WPC Day ${soon.day}, starts within 12 h` };
    }
    const meta = ERO_META[d1.category];
    return { value: meta.label, sub: `${meta.prob} probability · WPC Day 1` };
  })();

  const dailyRain = data.rain.source === 'daily';
  const rainStat = (() => {
    if (data.rain.unavailable) return { value: '—', sub: data.rain.unavailable };
    const src =
      data.rain.source === 'wpc' ? 'WPC' : data.rain.source === 'hourly' ? 'Open-Meteo hourly' : dailyRain ? 'daily forecast' : undefined;
    return {
      value: fmtIn(data.rain.in72),
      sub:
        [data.rain.in24 !== undefined ? `${dailyRain ? 'tomorrow' : '24 h'} ${fmtIn(data.rain.in24)}` : null, src]
          .filter(Boolean)
          .join(' · ') || undefined,
    };
  })();

  const pastStat = (() => {
    if (data.antecedent.unavailable) return { value: '—', sub: data.antecedent.unavailable };
    // A series with gaps leaves the totals uncomputed — the section says why.
    if (antecedentS?.unavailable) return { value: '—', sub: antecedentS.unavailable };
    return {
      value: fmtIn(data.antecedent.past7dIn),
      sub: `modelled${data.antecedent.past72In !== undefined ? ` · past 72 h ${fmtIn(data.antecedent.past72In)}` : ''}`,
    };
  })();

  // Gauge counts in the ring table are zeros when the feed is down — print
  // them as unknown instead.
  const gaugesDown = !gaugesS ? 'River gauges not assessed' : gaugesS.unavailable;
  const ringCell = (v: number) => (gaugesDown ? '—' : String(v));

  // Rainfall source note (same wording as the wildfire report's rainfall block).
  const rainSourceNote =
    data.rain.source === 'wpc'
      ? 'Chips are the WPC forecast at the property point — the same product the map renders'
      : data.rain.source === 'hourly'
        ? "Chips are the Open-Meteo hourly point forecast, summed from the current hour — WPC's forecast covers the lower 48 only (or is unavailable)"
        : dailyRain
          ? "Chips are whole calendar days from tomorrow (daily point forecast) — today's rain so far is under Recent rainfall"
          : null;

  // The property's local date, as the assembly resolved it.
  const localToday = data.localToday;
  // GloFAS days are UTC days (the section builder is handed the UTC date too).
  const dischargeToday = data.generatedAt.slice(0, 10);

  const femaMapCaption = 'FEMA NFHL flood hazard zones around the property · white ring = 1 mi';
  const eroMapCaption =
    'WPC Day 1 excessive-rainfall risk areas — probability that rainfall exceeds flash-flood guidance within 25 mi of a point · white ring = 25 mi';
  const qpfMapCaption = 'Regional accumulation over the next 72 h — official WPC color ramp · dashed ring = 25 mi';

  const dischargeCaption = (() => {
    const d = data.discharge;
    if (!d) return '';
    const cell =
      Number.isFinite(d.lat) && Number.isFinite(d.lon) ? ` (${d.lat.toFixed(3)}, ${d.lon.toFixed(3)})` : '';
    const th = d.thresholds;
    const rp = th
      ? ` · return periods: Gumbel fit to ${th.years} annual maxima, ${th.fromYear}–${th.toYear} reanalysis`
      : '';
    return `GloFAS v4 ensemble at the nearest model river cell${cell} — a ~5 km grid that may not represent small local streams${rp}`;
  })();

  const hourlyBlock = data.hourlyRain && (
    <div className="space-y-1">
      <div className="px-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white/35 print-muted">
        Rain timing — next 48 h, hourly
      </div>
      <RainTimingChart hourly={data.hourlyRain} />
      <Note>Hourly bars are the Open-Meteo model at the property — timing guidance; totals can differ from WPC</Note>
    </div>
  );

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-8 py-8">
      {/* BLUF */}
      <section
        className="print-card rounded-xl border p-5"
        style={{ borderColor: `${overall.color}55`, background: `${overall.color}0d` }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <LevelBadge level={data.overall.level} size="lg" />
          <span className="text-[14px] font-semibold text-white/90">{`Flood risk — ${data.target.name}`}</span>
        </div>
        <ul className="mt-3 space-y-1 text-[12px] leading-snug text-white/75">
          {data.overall.drivers.length === 0 ? (
            <li>No flood indicators near this property in any monitored feed.</li>
          ) : (
            data.overall.drivers.map((d, i) => <li key={i}>· {d}</li>)
          )}
        </ul>
      </section>

      {/* Hero exposure map: rings, gauges, alert areas and burn scars at once */}
      <div className="space-y-2">
        <MapFigure
          src={data.maps.exposure}
          caption={`Exposure map — analysis rings (${RISK_RINGS.map((r) => r.label).join(' / ')}), NWPS gauges colored by flood category (worse of observed and NWS forecast; hollow = not reporting), flood-alert areas in view, this year's burn scars (hatched)`}
        />
        {data.maps.exposure && <LegendRow items={[...GAUGE_LEGEND, BURN_SCAR_LEGEND]} />}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="FEMA flood zone" value={femaStat.value} sub={femaStat.sub} />
        <StatCard label="Flood alerts at site" value={alertStat.value} sub={alertStat.sub} />
        <StatCard label="Nearest gauge in flood" value={gaugeStat.value} sub={gaugeStat.sub} />
        <StatCard label="Excessive rainfall today" value={eroStat.value} sub={eroStat.sub} />
        <StatCard label={dailyRain ? 'Rain next 3 days' : 'Rain next 72 h'} value={rainStat.value} sub={rainStat.sub} />
        <StatCard label="Past 7 days" value={pastStat.value} sub={pastStat.sub} />
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
                <th className="px-3 py-2 text-right">Gauges</th>
                <th className="px-3 py-2 text-right">Action</th>
                <th className="px-3 py-2 text-right">In flood</th>
                <th className="px-3 py-2 text-right">Forecast flood</th>
              </tr>
            </thead>
            <tbody>
              {data.ringCounts.map((r) => (
                <tr key={r.ring.id} className="border-b border-white/5 text-white/70 last:border-0">
                  <td className="px-3 py-1.5 font-semibold">{r.ring.label}</td>
                  <td className="px-3 py-1.5 text-white/45">{r.ring.meaning}</td>
                  <td className="px-3 py-1.5 text-right">
                    {ringCell(r.gauges)}
                    {!gaugesDown && r.offline > 0 && <span className="text-white/40">{` + ${r.offline} dark`}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right">{ringCell(r.action)}</td>
                  <td className={`px-3 py-1.5 text-right ${!gaugesDown && r.flooding > 0 ? 'font-bold text-white/90' : ''}`}>
                    {ringCell(r.flooding)}
                  </td>
                  <td className={`px-3 py-1.5 text-right ${!gaugesDown && r.forecastFlooding > 0 ? 'font-bold text-white/90' : ''}`}>
                    {ringCell(r.forecastFlooding)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {gaugesDown ? (
          <Note>{`Gauge counts unknown — ${gaugesDown}`}</Note>
        ) : (
          <Note>Reporting NWPS forecast points per ring (+ dark = not reporting) · Action = observed near flood stage · In flood = observed minor flood or worse · Forecast flood = NWS forecast minor or worse, dark gauges included</Note>
        )}
      </section>

      {/* Flood alerts at the site */}
      {alertsS && (
        <Section section={alertsS}>
          {data.alerts.length > 0 && (
            <div className="space-y-2">
              {data.alerts.map((a, i) => <AlertCard key={i} alert={a} />)}
              <MapFigure
                src={data.maps.alerts}
                caption="Active flood-family alert areas over the property (NWS polygons / county shapes)"
              />
            </div>
          )}
        </Section>
      )}

      {/* River gauges */}
      {gaugesS && (
        <Section section={gaugesS}>
          {data.gauges.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-lg border border-white/8 bg-white/4">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-[9px] font-bold uppercase tracking-wider text-white/35">
                      <th className="px-3 py-2">Gauge</th>
                      <th className="px-3 py-2 text-right">Distance</th>
                      <th className="px-3 py-2">Now</th>
                      <th className="px-3 py-2">NWS forecast</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.gauges.map((g) => (
                      <tr key={g.lid || `${g.lat},${g.lon}`} className="border-b border-white/5 text-white/70 last:border-0">
                        <td className="px-3 py-1.5">
                          <span className="font-semibold">{g.name}</span>
                          {g.state && <span className="text-white/40">{`, ${g.state}`}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{`${num(g.distanceMi, 1)} mi`}</td>
                        <td className="px-3 py-1.5">
                          <span className="flex flex-wrap items-center gap-2">
                            {g.offline ? <OfflineChip status={g.offline} /> : <CatChip cat={g.cat} />}
                            <span className="tabular-nums text-white/60">
                              {g.stage === null ? '—' : `${fmtGaugeValue(g.stage, g.unit)} ${g.unit}`}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-1.5">{g.fcat ? <CatChip cat={g.fcat} /> : <span className="text-white/35">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Note>NWPS forecast points within 25 mi (those in flood first, up to 10), plus up to 6 farther points within 100 mi that are in or forecast to reach flood stage</Note>
            </>
          )}
        </Section>
      )}
      {data.gaugeDetails.length > 0 && (
        <div className="space-y-3">
          <BlockTitle>Gauge forecasts &amp; flood impacts</BlockTitle>
          {data.gaugeDetails.map((d) => <GaugeDetailCard key={d.lid} detail={d} />)}
        </div>
      )}

      {/* FEMA flood zone — the zones map still prints when the site itself
          has no zone (it shows the floodplain next door) */}
      {femaS && (
        <>
          <Section section={femaS}>
            <div className="space-y-2">
              <MapFigure src={data.maps.fema} caption={femaMapCaption} />
              {data.maps.fema && <LegendRow items={FEMA_LEGEND} />}
              <Note>FEMA zones express long-term (annual-chance) exposure, not current flooding — the live sections below say what is happening now</Note>
            </div>
          </Section>
          {femaS.unavailable && data.maps.fema && (
            <div className="space-y-2">
              <MapFigure src={data.maps.fema} caption={`${femaMapCaption} — no zone at the property point itself`} />
              <LegendRow items={FEMA_LEGEND} />
            </div>
          )}
        </>
      )}

      {/* Excessive Rainfall Outlook — Day 1–5 strip above the Day 1 map */}
      {eroS && (
        <>
          <Section section={eroS}>
            <div className="space-y-2">
              {data.ero.days && data.ero.days.length > 0 && <EroStrip days={data.ero.days} todayIso={localToday} />}
              <MapFigure src={data.maps.ero} caption={eroMapCaption} />
              {data.maps.ero && <LegendRow items={ERO_LEGEND} />}
            </div>
          </Section>
          {eroS.unavailable && data.maps.ero && (
            <div className="space-y-2">
              <MapFigure src={data.maps.ero} caption={`${eroMapCaption} — the outlook at the property point could not be read`} />
              <LegendRow items={ERO_LEGEND} />
            </div>
          )}
        </>
      )}

      {/* Forecast rainfall — site chips, regional WPC map, hourly timing */}
      {rainS && (
        <>
          <Section section={rainS}>
            <div className="space-y-2">
              {rainCells(data.rain, dailyRain).length > 0 && <ChipStrip cells={rainCells(data.rain, dailyRain)} />}
              <MapFigure src={data.maps.qpf} caption={qpfMapCaption} />
              {data.maps.qpf && <QpfRampLegend />}
              {rainSourceNote && <Note>{rainSourceNote}</Note>}
              {hourlyBlock}
            </div>
          </Section>
          {rainS.unavailable && (data.maps.qpf || data.hourlyRain) && (
            <div className="space-y-2">
              <MapFigure src={data.maps.qpf} caption={qpfMapCaption} />
              {data.maps.qpf && <QpfRampLegend />}
              {hourlyBlock}
            </div>
          )}
        </>
      )}

      {/* Recent rainfall — how wet the ground already is */}
      {antecedentS && (
        <Section section={antecedentS}>
          {data.antecedent.days && data.antecedent.days.length > 0 && (
            <div>
              <RainLedger days={data.antecedent.days} todayIso={localToday} />
              <Note>Open-Meteo model estimate of rain already fallen — not rain-gauge observations</Note>
            </div>
          )}
        </Section>
      )}

      {/* Burn scars — the drivers say it all */}
      {burnS && <Section section={burnS} />}

      {/* River discharge (GloFAS) — the chart still prints for trend when the
          return-period thresholds (and so the level) are unavailable */}
      {dischargeS && (
        <>
          <Section section={dischargeS}>
            {data.discharge && dischargeHasData(data.discharge) && (
              <div>
                <DischargeChart discharge={data.discharge} todayIso={dischargeToday} />
                <Note>{dischargeCaption}</Note>
              </div>
            )}
          </Section>
          {dischargeS.unavailable && data.discharge && dischargeHasData(data.discharge) && (
            <div>
              <DischargeChart discharge={data.discharge} todayIso={dischargeToday} />
              <Note>{`${dischargeCaption} · shown for trend only`}</Note>
            </div>
          )}
        </>
      )}

      {/* 10-day forecast strip */}
      <section className="print-card">
        <BlockTitle>10-day forecast</BlockTitle>
        {'days' in data.forecastDaily ? (
          <ForecastStrip forecast={data.forecastDaily} showPrecipAmount />
        ) : (
          <Unavailable>{data.forecastDaily.unavailable}</Unavailable>
        )}
      </section>

      <SourcesFooter sources={data.sources} gaps={data.gaps} generatedAt={data.generatedAt} />
    </main>
  );
}
