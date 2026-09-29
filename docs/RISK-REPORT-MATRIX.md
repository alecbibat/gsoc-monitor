# Property Risk Report — Hazard-Input Matrix

The core design artifact for the risk report (roadmap Track 3): each hazard has a
FIXED definition of inputs, thresholds, and report sections, so the same property
analyzed twice gives the same answer. The report never keys off map zoom.

## Analysis rings (fixed, not zoom-driven)

| Ring | Radius | Question it answers |
|---|---|---|
| Site | property point | Is the property itself inside an alert/outlook area? |
| Immediate | 1 mi | Evacuation and direct impact |
| Local | 5 mi | Mutual aid, staging, immediate access |
| Area | 25 mi | Supply, staff commute, regional resources |
| Regional | 100 mi | Logistics, alternate lodging, medical referral |

Counts and distances in the report are computed against these rings; any map
graphic may be drawn at whatever extent reads best.

## Risk levels

`low → guarded → elevated → high → critical`, each section reporting its own
level plus plain-English drivers. The overall rating is the worst section level,
with every driver listed — transparent, not a black-box weighted score. (If the
rating ever drives a documented decision threshold — open question Q6 — the
formula gets revisited with that QA bar.)

## Wildfire (implemented)

| Input | Source (existing store/route) | Threshold → level contribution |
|---|---|---|
| Satellite hotspots (VIIRS FRP) | FIRMS layer store | any ≤1 mi → critical · ≤5 mi → high · ≤25 mi → elevated · ≤100 mi → guarded; FRP > 100 MW near (≤25 mi) bumps one level |
| Named incidents (acreage, containment) | NIFC/WFIGS layer store | uncontained (<50%) ≤25 mi → high · ≤100 mi → elevated; ≥1000 acres bumps one level |
| Fire-weather alerts | NWS alerts store (point-in-polygon at site) | Red Flag Warning / evacuation-class → high · Fire Weather Watch → elevated · other fire-family alert → guarded |
| 7-day fire-potential outlook | NWCG PSA layer (site containment) | Critical → high · Elevated/Ignition → elevated · normal-dry → guarded |
| Fuel conditions | LANDFIRE zonal histogram, 3 mi ring (existing analyzer) | FBP score ≥70 → elevated driver · ≥85 → high driver (standard-conditions caveat printed) |
| Wind now / 48 h peak | wind point-forecast route | sustained ≥25 mph or gusts ≥35 → elevated driver · sustained ≥35 / gusts ≥50 → high driver |
| Smoke (HMS plumes) | `/api/smoke` (NOAA HMS, analyst-drawn from GOES/VIIRS) | Heavy plume over the site → elevated · Medium → guarded · Light → low with driver; count-framed ("None / Light / Medium / Heavy overhead"); stale-analysis caveat printed when the latest HMS day is not today; outside North America → unavailable (HMS coverage), satellite snapshot still rendered |
| Lightning (24 h strikes) | `/api/lightning/near?lat&lon&radiusMi=130&hours=24` (Blitzortung; the server records every strike) | nearest strike ≤5 mi → elevated (ignition source) · ≤25 mi → guarded; count-framed ("N ≤25 mi"); counts are computed server-side over every stored strike before any map-point thinning, and used as-is; the nearest strike is taken over all stored strikes in the window; "≈" while pre-upgrade 1-in-6 history is inside the window (counted ×6, with a caveat); once the memory cap has evicted positions inside the window the counts and nearest strike cover only the time since, so they print as lower bounds ("≥N ≤25 mi", "None ≤25 mi since HH:MM") — "≥" wins over "≈" — and only the global `/status` counts stay exact; caveats for collector blind spots (≥10 min in total), history still restoring, collector offline, and evicted positions (a nearby strike before HH:MM would be missed) always reach the BLUF, even at Low; an older server without `/near` falls back to `/api/lightning`, whose 1-in-6 history is counted ×6 with "≈" and a sampling caveat in the BLUF |

Section list in the report: BLUF (overall + drivers) · hero exposure map ·
key stat cards · ring exposure table · hotspots · named incidents · alerts ·
outlook (7-day PSA chip strip above one regional today-map + legend) · fuels
(raster map + fuel-group legend) · wind chart · smoke (HMS plumes as 45°
HATCHING + cased outlines over the GIBS MODIS true-color mosaic — hatch
density scales with smoke density, and the imagery beneath stays visible) ·
lightning (24 h strike map: X marks in the globe's age ramp) · rainfall (site 24/48/72 h chip strip —
WPC identify at the property point, same product as the map, daily-forecast
fallback labeled as such — above one regional WPC 72 h map + exact WPC ramp
legend) · 10-day forecast strip · sources with retrieval timestamps.

Known gaps (listed in the report footer): RH/fuel-moisture not yet ingested
(needs an RH grid — Track 4); terrain slope not factored (needs DEM sampling —
chunk 8b); LANDFIRE fuels are CONUS-only, so the fuel section degrades to
"unavailable" for Windstar/international assets.

## Flood (implemented)

Same frame as wildfire: fixed rings, each section its own level + drivers, the
overall rating is the worst available section, a down feed is "unavailable"
(never a silent Low). Static exposure (the FEMA zone) never lifts the level on
its own beyond Guarded — it escalates the live signals instead.

| Input | Source | Threshold → level contribution |
|---|---|---|
| Flood-family alerts at the site | NWS **point lookup** (`/alerts/active?point=`, direct then via the server proxy) — NWS resolves its own forecast zones, county zones and storm polygons; the national list only draws the regional map | **critical**: Flash Flood Warning (incl. Flash Flood Emergency — `flashFloodDamageThreat` CATASTROPHIC or "flash flood emergency" in the text), Storm Surge Warning, Tsunami Warning · **high**: Flood Warning, Coastal Flood Warning, Lakeshore Flood Warning, Hurricane Warning, Typhoon Warning · **elevated**: Flash Flood Watch, Flood Watch, Coastal/Lakeshore Flood Watch, Storm Surge Watch, Tsunami Watch/Advisory, Hurricane Watch, Typhoon Watch, Tropical Storm Warning · **guarded**: every other flood-family product (Flood/Coastal/Lakeshore Flood Advisory, Flood/Flash Flood/Coastal Flood Statement, Hydrologic Outlook, Tropical Storm Watch, Hurricane Local Statement…). Marine "Hurricane Force Wind" products are excluded. Count-framed ("None active / N active"). **Point lookup down** → fallback to the national list placed by the alert's own polygon, else its SAME county outline; county-placed hits are worded "issued for the property's county — confirm…", county-placed Storm Surge / Tsunami / Coastal / Lakeshore products are capped at Elevated (NWS splits coastal counties into coastal and inland zones), and a ⚠ caveat reaches the BLUF. In a territory the county outlines don't cover (USVI, Guam/CNMI, American Samoa) that fallback can't place zone alerts → unavailable, or with a polygon hit a ⚠ "more may be in effect". Both paths down → unavailable |
| River gauges | NWPS national list (`/api/rivers`) — tier = worse of observed and NWS-forecast category; points whose observation is out of service or stale arrive in a separate `offline` list | **≤5 mi**: major → critical · moderate → high · minor → elevated · action → guarded. **5–25 mi**: major → high · moderate → elevated · minor → guarded. **25–100 mi**: major/moderate → guarded. A dark gauge rates from its NWS forecast when it still has one; without one, every dark gauge ≤25 mi is a ⚠ caveat ("not reporting since … — river state there unknown") that reaches the BLUF at any level, and the context line names the nearest *reporting* gauge. Ring counts: the observed columns cover reporting gauges; forecast flooding includes dark gauges, which are also counted on their own. Count-framed ("N in flood ≤25 mi"). Server snapshot still warming → unavailable; outside the US with nothing ≤100 mi → unavailable (NWPS covers the US) |
| Gauge forecasts & impacts | NWPS per-gauge detail (`/api/rivers/:lid`) for up to 3 gauges ≤25 mi (flooding first, then nearest; a dark gauge only while it carries an NWS forecast) | Context only (hydrograph with flood-stage lines, forecast crest, NWS impact statements, record crest) — the level comes from the gauge row above |
| Excessive Rainfall Outlook | WPC `wpc_precip_hazards` MapServer, Days 1–5 (point query per day, highest nested category) | **Day 1** — and any day whose 12Z–12Z period starts within 12 h (overnight that is "Day 2", the coming daytime): High/Moderate → high · Slight → elevated · Marginal → guarded. **Days 2–3**: High/Moderate → elevated · Slight → guarded · Marginal → driver only. **Days 4–5**: High/Moderate → guarded, else driver only. Period starts come from the product when the site is in a risk area, else from WPC's cycle (the new Day 1 starting 12Z is issued ~09Z). Outside CONUS → unavailable |
| Forecast rainfall | Rain still to come: WPC QPF identify at the site (same product as the map) · else the Open-Meteo hourly point forecast summed from the current hour (the source outside the lower 48) · else whole calendar days from **tomorrow** (today's calendar total already holds rain that has fallen, which the antecedent row counts) | **high**: 24 h ≥ 4 in or 72 h ≥ 6 in · **elevated**: 24 h ≥ 2 in or 72 h ≥ 4 in · **guarded**: 24 h ≥ 1 in, 72 h ≥ 2 in or 5-day ≥ 3 in. Wet-ground escalator: past 72 h ≥ 2 in or past 7 days ≥ 3 in bumps a non-Low rainfall level one step; dry ground is only concluded when both totals are in — wetness undetermined (feed down, or a total lost to a model gap) → no bump, ⚠ caveat instead |
| Recent rainfall (antecedent) | Open-Meteo modelled past 7 days at the site (not rain-gauge observations — labeled so); hourly values are preceding-hour sums; a gap in a window leaves that total uncomputed, never zero | **elevated**: past 72 h ≥ 4 in · **guarded**: past 72 h ≥ 2 in or past 7 days ≥ 3 in · else Low with the 7-day total as a driver; neither total computable → unavailable |
| FEMA flood zone | FEMA NFHL layer 28 (Flood Hazard Zones) via `/api/flood/zone` | Any SFHA zone (exact codes A, AE, AH, AO, AR, A99, A1–A30, V, VE, V1–V30) → guarded, with the floodway (incl. encroachment areas) and V/VE coastal high-hazard called out · shaded X (0.2% annual chance, and the 1% areas FEMA leaves outside the SFHA: under 1 ft deep, drainage under 1 sq mi, future conditions), levee-reduced, minimal (X), undetermined (D) → Low with the zone as a driver · nearest SFHA ≤ 0.25 mi when outside it → driver. No polygon in the query envelope → unavailable ("no digital flood map"); "AREA NOT INCLUDED" → unavailable (unstudied, never an SFHA); outside the US → unavailable. FEMA's record cap hit, or the zone-map query failed while the point answered → ⚠ caveat. Count label = the zone ("Zone AE") |
| SFHA escalator (overall) | FEMA zone × live sections | Property inside the SFHA and any live section (alerts, gauges, outlook, rainfall, burn scars, river discharge) at Elevated or worse → overall bumps one level, with the zone named in the driver |
| Burn scars | NIFC WFIGS **year-to-date** perimeter archive (every fire reported this year, active or out), ≥100 acres, queried within 130 mi of the property | nearest perimeter ≤10 mi → guarded · ≤10 mi **and** a rain signal (Day 1–3 ERO ≥ Marginal at the site, or 72 h rainfall ≥ 0.5 in) → elevated · ≤2 mi (or inside) **and** a strong rain signal (Day 1–2 ERO ≥ Slight, or 24 h rainfall ≥ 1 in) → high. Outlook and rainfall both unavailable → ⚠ "rain signal unknown". Record cap hit with no scar ≤10 mi → unavailable (a near scar may be missing). Jan–Apr → ⚠ caveat that the archive restarted in January. Outside the US → unavailable |
| River discharge (model) | GloFAS v4 via Open-Meteo Flood API (`/api/flood/discharge`), the ~5 km model cell containing the property (queries snap to cell centres); return-period flows from a Gumbel fit (method of moments — GloFAS itself fits Gumbel, by L-moments over a longer record) to the annual maxima of the last 20 complete reanalysis years, persisted per model cell (the 20-year pull costs ~520 Open-Meteo calls, so it runs once per cell per year, not per report) | peak ensemble median over today and the next 10 days ≥ 20-yr → high · ≥ 5-yr → elevated · ≥ 2-yr → guarded · otherwise ensemble max ≥ 5-yr → guarded ("some members"). Capped at Guarded when an NWPS point ≤25 mi carries a **current NWS river forecast** (named in the driver — the official forecast leads; a dark point only when that forecast is action stage or worse); with none, the level stands and says "model only" — or, when the NWPS list itself is down, that it could not check. 2-yr flow < 5 m³/s → Low, "minor stream — not assessed". Thresholds unavailable → unavailable (the chart still renders) |

In every live section a ⚠ caveat (a dark gauge, an alert lookup that fell
back to county outlines, a rain signal that could not be read) reaches the
BLUF even when the section is Low — a blind spot must never read as a calm day.

Section list in the report: BLUF (overall + drivers) · hero exposure map
(rings, NWPS gauges colored by flood category — hollow when not reporting —,
active flood-alert areas in view, this year's burn scars) · key stat cards · ring exposure table (gauges,
action, flooding, forecast flooding per ring) · flood alerts (with the NWS
WHAT/WHERE/WHEN/IMPACTS bullets) + alert map · river gauges table · gauge
forecast cards (hydrograph with flood-stage lines, crest, impacts) · FEMA flood
zone (NFHL zones map + legend) · Excessive Rainfall Outlook (Day 1–5 chip strip
above the Day 1 regional map + legend) · forecast rainfall (24/48/72 h/5-day
chips above the WPC 72 h map, 48 h hourly timing chart) · recent rainfall
(past 7 days) · burn scars · river discharge (GloFAS chart with return-period
lines) · 10-day forecast strip · sources.

Known gaps (listed in the report footer): flash-flood guidance grids (FFG);
coastal water-level/tide gauges (NOAA CO-OPS); dam and levee condition (USACE
NID/NLD); snowpack and snowmelt; soil moisture (antecedent rainfall is the
proxy); observed (radar + gauge) rainfall; burn scars from earlier years'
fires; site elevation vs. base flood elevation; urban drainage capacity.

## Severe weather / winter / seismic / utility (sketches)

- **Severe**: NWS convective warnings at site; SPC outlooks are a data gap.
- **Winter**: winter-family alerts at site; road-closure feeds are a gap (roadmap lists state DOT feeds).
- **Seismic**: USGS quakes magnitude/distance (M5+ ≤25 mi → high); ShakeMap intensity is a gap.
- **Utility**: outage feeds ≤25 mi with customers-affected scale; generator runtime cross-reference arrives with the asset layer (Track 2).

Each later hazard fills its table here BEFORE its UI is built.
