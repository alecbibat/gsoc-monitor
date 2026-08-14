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
| Lightning (24 h strikes) | `/api/lightning?minutes=1440&lat&lon&radiusMi=130` (Blitzortung) | nearest strike ≤5 mi → elevated (ignition source) · ≤25 mi → guarded; count-framed ("N ≤25 mi"); the server filters to the 130 mi radius BEFORE its 20k response cap so local counts arrive unthinned; if a response is still stride-sampled, counts are scaled estimates marked "≈" with an explicit sampling caveat; partial-coverage caveat when server history < ~23 h |

Section list in the report: BLUF (overall + drivers) · hero exposure map ·
key stat cards · ring exposure table · hotspots · named incidents · alerts ·
outlook (7-day PSA chip strip above one regional today-map + legend) · fuels
(raster map + fuel-group legend) · wind chart · smoke (density-colored HMS
plume OUTLINES over the GIBS MODIS true-color mosaic — outlines, not fills,
so heavy smoke never obscures the imagery that shows it) · lightning
(age-tinted strike map) · rainfall (site 24/48/72 h accumulation chip strip
above one regional WPC 72 h map) · 10-day forecast strip · sources with
retrieval timestamps.

Known gaps (listed in the report footer): RH/fuel-moisture not yet ingested
(needs an RH grid — Track 4); terrain slope not factored (needs DEM sampling —
chunk 8b); LANDFIRE fuels are CONUS-only, so the fuel section degrades to
"unavailable" for Windstar/international assets.

## Flood (next)

| Input | Source | Threshold sketch |
|---|---|---|
| River gauges | NWPS rivers store | any gauge ≤25 mi at/above flood stage, or forecast to crest above |
| Forecast rain | WPC QPF layer | 24 h QPF ≥2 in over site → elevated; ≥4 in → high |
| Flood alerts | NWS alerts store | Flash Flood Warning at site → critical |
| Burn scars | (gap — no source yet) | — |

## Severe weather / winter / seismic / utility (sketches)

- **Severe**: NWS convective warnings at site; SPC outlooks are a data gap.
- **Winter**: winter-family alerts at site; road-closure feeds are a gap (roadmap lists state DOT feeds).
- **Seismic**: USGS quakes magnitude/distance (M5+ ≤25 mi → high); ShakeMap intensity is a gap.
- **Utility**: outage feeds ≤25 mi with customers-affected scale; generator runtime cross-reference arrives with the asset layer (Track 2).

Each later hazard fills its table here BEFORE its UI is built.
