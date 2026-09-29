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
| Flood-family alerts at the site | NWS alerts (point-in-polygon, county geometry for zone/county alerts) | **critical**: Flash Flood Warning (incl. Flash Flood Emergency — `flashFloodDamageThreat` CATASTROPHIC or "flash flood emergency" in the text), Storm Surge Warning, Tsunami Warning · **high**: Flood Warning, Coastal Flood Warning, Lakeshore Flood Warning, Hurricane Warning, Typhoon Warning · **elevated**: Flash Flood Watch, Flood Watch, Coastal/Lakeshore Flood Watch, Storm Surge Watch, Tsunami Watch/Advisory, Hurricane Watch, Typhoon Watch, Tropical Storm Warning · **guarded**: every other flood-family product (Flood/Coastal/Lakeshore Flood Advisory, Flood/Flash Flood/Coastal Flood Statement, Hydrologic Outlook, Tropical Storm Watch, Hurricane Local Statement…). Marine "Hurricane Force Wind" products are excluded. Count-framed ("None active / N active"); county shapes down with no hit → unavailable |
| River gauges | NWPS national list (`/api/rivers`) — tier = worse of observed and NWS-forecast category | **≤5 mi**: major → critical · moderate → high · minor → elevated · action → guarded. **5–25 mi**: major → high · moderate → elevated · minor → guarded. **25–100 mi**: major/moderate → guarded. Count-framed ("N in flood ≤25 mi"). Server snapshot still warming → unavailable; outside the US with nothing ≤100 mi → unavailable (NWPS covers the US) |
| Gauge forecasts & impacts | NWPS per-gauge detail (`/api/rivers/:lid`) for up to 3 gauges ≤25 mi (flooding first, then nearest) | Context only (hydrograph with flood-stage lines, forecast crest, NWS impact statements, record crest) — the level comes from the gauge row above |
| Excessive Rainfall Outlook | WPC `wpc_precip_hazards` MapServer, Days 1–5 (point-in-polygon, highest nested category) | **Day 1**: High/Moderate → high · Slight → elevated · Marginal → guarded. **Days 2–3**: High/Moderate → elevated · Slight → guarded · Marginal → driver only. **Days 4–5**: High/Moderate → guarded, else driver only. Outside CONUS → unavailable |
| Forecast rainfall | WPC QPF identify at the site (same product as the map); Open-Meteo daily sums as a labeled fallback | **high**: 24 h ≥ 4 in or 72 h ≥ 6 in · **elevated**: 24 h ≥ 2 in or 72 h ≥ 4 in · **guarded**: 24 h ≥ 1 in, 72 h ≥ 2 in or 5-day ≥ 3 in. Wet-ground escalator: past 72 h ≥ 2 in or past 7 days ≥ 3 in bumps a non-Low rainfall level one step |
| Recent rainfall (antecedent) | Open-Meteo modelled past 7 days at the site (not rain-gauge observations — labeled so) | **elevated**: past 72 h ≥ 4 in · **guarded**: past 72 h ≥ 2 in or past 7 days ≥ 3 in · else Low with the 7-day total as a driver |
| FEMA flood zone | FEMA NFHL layer 28 (Flood Hazard Zones) via `/api/flood/zone` | Any SFHA zone (A, AE, AH, AO, AR, A99, V, VE) → guarded, with the floodway and V/VE coastal high-hazard called out · 0.2%-annual-chance (shaded X), levee-reduced, minimal (X), undetermined (D) → Low with the zone as a driver · nearest SFHA ≤ 0.25 mi when outside it → driver. No polygon in the query envelope → unavailable ("no digital flood map"); outside the US → unavailable. Count label = the zone ("Zone AE") |
| SFHA escalator (overall) | FEMA zone × live sections | Property inside the SFHA and any live section (alerts, gauges, outlook, rainfall, burn scars, river discharge) at Elevated or worse → overall bumps one level, with the zone named in the driver |
| Burn scars | NIFC WFIGS current-season perimeters ≥100 acres (the wildfire layer's perimeter feed) | nearest perimeter ≤10 mi → guarded · ≤10 mi **and** a rain signal (Day 1–3 ERO ≥ Marginal at the site, or 72 h QPF ≥ 0.5 in) → elevated · ≤2 mi (or inside) **and** a strong rain signal (Day 1–2 ERO ≥ Slight, or 24 h QPF ≥ 1 in) → high. Outside the US → unavailable |
| River discharge (model) | GloFAS v4 via Open-Meteo Flood API (`/api/flood/discharge`), nearest ~5 km model river cell; return-period flows from a Gumbel fit (method of moments — the GloFAS method) to the annual maxima of the last 20 complete reanalysis years, persisted per model cell (the 20-year pull costs ~520 Open-Meteo calls, so it runs once per cell, not per report) | peak ensemble median over the next 15 days ≥ 20-yr → high · ≥ 5-yr → elevated · ≥ 2-yr → guarded · otherwise ensemble max ≥ 5-yr → guarded ("some members"). Capped at Guarded when an NWPS gauge exists ≤25 mi (the official forecast leads). 2-yr flow < 5 m³/s → Low, "minor stream — not assessed". Thresholds unavailable → unavailable (the chart still renders) |

Section list in the report: BLUF (overall + drivers) · hero exposure map
(rings, NWPS gauges colored by flood category, active flood-alert areas in view,
current-season burn scars) · key stat cards · ring exposure table (gauges,
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
proxy); burn scars from earlier seasons; site elevation vs. base flood
elevation; urban drainage capacity.

## Severe weather / winter / seismic / utility (sketches)

- **Severe**: NWS convective warnings at site; SPC outlooks are a data gap.
- **Winter**: winter-family alerts at site; road-closure feeds are a gap (roadmap lists state DOT feeds).
- **Seismic**: USGS quakes magnitude/distance (M5+ ≤25 mi → high); ShakeMap intensity is a gap.
- **Utility**: outage feeds ≤25 mi with customers-affected scale; generator runtime cross-reference arrives with the asset layer (Track 2).

Each later hazard fills its table here BEFORE its UI is built.
