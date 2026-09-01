# GSOC Monitor — Platform White Paper

# Executive Summary

GSOC Monitor is a working, deployed situational-awareness and incident-command platform. This paper documents it from the code: what it does, how it is built, where its data comes from, how mature each part is, and what should constitute its minimum viable product.

## What it is

A browser-based 3D globe for a Global Security Operations Center that fuses live hazard feeds — weather, wildfire, smoke and air quality, earthquakes, tropical cyclones, lightning, river flooding, power outages, aircraft, ships, satellites and open-source news — into one operating picture; scans a portfolio of 31 properties in 13 groups and a seven-ship fleet against those feeds with an explainable 0–100 threat score and an optional AI-written duty-officer briefing; and, when an incident occurs, becomes a full incident-command workspace with a synchronised multi-operator record, ICS organisation chart, action log, checklists, drawn map layers, password-protected share links for stakeholders, an Incident Action Plan library, a stand-down sequence and an after-action report.

## What the review found

<div class="stat-row"><div class="stat"><div class="n">303</div><div class="l">Capabilities catalogued</div></div><div class="stat"><div class="n">84%</div><div class="l">Production-ready</div></div><div class="stat"><div class="n">~90</div><div class="l">Upstream data feeds</div></div><div class="stat"><div class="n">50</div><div class="l">Verified defects</div></div></div>

- **Breadth.** Twelve subsystems, 29 server routes, 24 map layers, seven background collectors and about ninety upstream feeds from roughly forty providers. Nearly every feed is free; the only unavoidable spend is the single Heroku dyno and its Postgres database, with optional paid tiers for dependable vessel positions, the AI briefing and photorealistic 3D imagery.
- **Depth where it matters.** The crisis workspace is engineered against lost updates on the paths that carry the record of a response — the action log and checklists are row-locked and per-entry, twelve kinds of audit events are written automatically, and share links have passwords, a 72-hour expiry, revocation and an access log. The proxy tier caches with stale-on-error and request coalescing; the globe recovers from a lost GPU context on its own.
- **Honest limits.** Everything tenant-specific — properties, fleet, aircraft, templates, briefing context — is compiled into the code. The system is single-process by design. Monitoring is pull-only with no notifications or history. Coverage is US-centric while the fleet sails internationally. Every report is produced through the browser's print dialog. One checklist template serves all 26 incident types.
- **Security posture.** A parallel adversarially-verified review found 50 defects: 9 high, 19 medium and 22 low, and no critical. The high-severity items cluster in session revocation (a deleted user's 30-day session keeps working), abuse of unauthenticated routes (arbitrary-URL fetching, 50 MB pre-auth body parsing, unmetered AI calls, an unbounded cache), a login limiter that lets a stranger lock out the whole team, concurrent-operator data loss in the incident blob, and an air-quality adapter that never renders the official monitors. None is architecturally difficult.

## The MVP recommendation

Feature scope is not what stands between this codebase and a first customer; hardening is. The recommended MVP is the current production-ready core — globe, hazard layers, asset tracking, Property Watch and dashboard, the wildfire risk report and fuel analyzer, the full crisis workspace with sharing and after-action reporting, authentication and admin — shipped after closing the security gate in the bug report, provisioning the free keys the product silently depends on, deciding the vessel-tracking budget, documenting the two required environment variables, and removing dead code. Fleet tracking, the intelligence feed and the location-details panel ship with stated caveats; the hidden 3D imagery layer, the placeholder crisis tabs and the share-page-only intel pins are deferred.

## How to read this paper

Chapter 2 describes the product and its users. Chapter 3 covers the architecture, data tier, identity model, configuration and deployment. Chapters 4 and 5 are the two chapters the product owner asked for by name: threat monitoring, domain by domain, and crisis response, end to end. Chapter 6 is the data-source register. Chapter 7 gives the maturity assessment and the MVP feature cut, and Chapter 8 the platform's known limitations. The companion documents are the *Bug and Vulnerability Report* and the *Product Roadmap Analysis* covering V1 through V4.


# What GSOC Monitor Is

GSOC Monitor is a browser-based common operating picture for a Global Security Operations Center. It puts every hazard feed a duty officer needs on one 3D globe, watches a fixed portfolio of properties and vessels against those feeds, and — when something happens — turns into an incident-command workspace that the same team uses to run the response and brief stakeholders.

## Purpose

The product answers three questions continuously:

1. **What is happening in the world right now?** Weather warnings, wildfire, smoke and air quality, earthquakes, tropical cyclones, lightning, river flooding, power outages, aircraft, ships, satellites and open-source news are rendered live on a single globe with consistent click-to-detail behaviour.
2. **Does any of it touch our assets?** A hardcoded portfolio of 13 property groups (31 locations — national-park lodging concessions, corporate offices, an airport hangar, a resort, a railway and tour operators) and a seven-ship cruise fleet is scanned against the feeds at fixed distance rings, scored 0–100 per property, and summarised in a status dashboard with an optional AI-written duty-officer briefing.
3. **How do we run the response?** A full-screen crisis workspace holds the incident record — situation report, ICS organisation chart, action log, checklists, intake questionnaire, drawn map layers — synchronises it across every operator in real time, publishes password-protected share links for executives and partners, serves the Incident Action Plan, and produces an after-action report when the incident stands down.

## Who uses it

- **Duty officers and analysts** keep the globe on wall displays and desktops, toggle layers, open detail panels, run the Property Watch scan and read the dashboard. Four cinematic screensaver tours keep an unattended display informative.
- **Incident commanders and section chiefs** work inside the crisis workspace: they log actions, assign ICS roles, tick checklist items and draw incident geometry. Several operators can work the same incident at once.
- **Stakeholders outside the team** — executives, property managers, partner agencies — receive a share link and see a phone-friendly read-only situation page with live hazard cards, the map, the IAP and the checklists, without an account.
- **The administrator** manages team accounts, the signup code and the IAP document library.

## Operating model

The application is a single deployment serving one team. Everyone signs in with an email, a password and a shared invite code; the first account becomes the administrator. There is no multi-tenant model: the monitored properties, the fleet roster, the tracked aircraft, the checklist template and the AI briefing's context are compiled into the code for the current operator, a hospitality and cruise-line portfolio.

It runs as one Node process on one Heroku dyno with a Postgres database. Public data feeds are pulled from roughly forty providers, nearly all free; most map imagery and several feature services are fetched straight from the operator's browser to keep load off the server, and the server proxies, caches and aggregates the rest. Seven background collectors keep aircraft, vessel, lightning, wind, river, outage and intelligence state current whether or not anyone is watching.

## Two modes of operation

**Monitoring mode** is the default globe: layers, panels, the dashboard and the widgets. It is read-mostly, and every feed degrades independently — a dead upstream leaves a visible status line, never a blank screen.

**Crisis mode** is entered with the red CRISIS button. The globe docks into a map window inside the incident workspace, and the incident record becomes the shared document of the response. When the incident closes, a three-step stand-down publishes the final snapshot to every share link, revokes the links, releases open ICS assignments and archives the record; a Reopen path exists if the situation changes.

## What this paper covers

The following chapters describe the platform from the code as it stands: the architecture and its resilience design, the threat-monitoring capabilities by hazard domain, the crisis-response workflow end to end, the full data-source register, a maturity assessment with the recommended MVP feature set, and the platform's known limitations. A companion bug and vulnerability report and a version roadmap accompany this paper.


# Platform Architecture

GSOC Monitor is a three-tier web application: a browser-side 3D globe built on CesiumJS, a single Node/Express process that proxies, caches and aggregates public data feeds, and a Heroku Postgres database that holds the team's own records. The whole system runs on one Heroku "basic" dyno and is designed so that a database outage, a dead upstream feed, or a lost GPU context degrades one feature rather than the whole console.

## System overview

The platform has two data paths, and knowing which path a feed uses explains most of its behaviour.

- **Browser-direct feeds.** Basemap tiles (Esri, NASA GIBS, OpenTopoMap), Cesium ion terrain and buildings, RainViewer radar tiles, NASA FIRMS hotspots, NIFC/WFIGS fire incidents, NHC hurricane services, Blitzortung live lightning, BigDataCloud reverse geocoding, Cloudinary uploads, the LANDFIRE fuel ImageServer, the WPC precipitation MapServer, and the county-polygon file are fetched straight from the operator's browser. These providers are CORS-enabled and free, and keeping tile and feature traffic off the single dyno is a deliberate design choice. The cost is that corporate network filtering can blank a layer while the server is healthy, so every layer shows an explicit status line.
- **Same-origin `/api` proxies.** Everything else goes through the Express server: NWS alerts (as a fallback), USGS earthquakes, the RainViewer manifest, HMS smoke, AirNow/PurpleAir air quality, the NWCG fire outlook, NWPS river gauges, lightning history, ADS-B flights, satellites, ships, wind, outages, JTWC, geocoding, news, GDELT, the OSINT intel feed, and all of the team's own data (auth, incidents, share links, watchlist, IAP documents, briefing).

The server exists for four reasons: to attach identifying User-Agent strings that provider policies require (NWS, Nominatim, CelesTrak), to hold API keys that must not reach the browser, to run background collectors that keep state while no client is connected, and to cache aggressively so a room full of wall displays produces one upstream request instead of twenty.

## The globe client

The client is a React 18 + Vite 5 single-page application with CesiumJS 1.121, Zustand for state, Tailwind for styling and react-rnd for panel windows. One `Cesium.Viewer` is created for the lifetime of the session and never rebuilt for navigation; when the crisis workspace opens, the globe is pinned into the workspace's map window by resizing its container rather than re-mounting it, so camera position, imagery and every loaded layer survive.

**Basemaps.** Five map types are available from the sidebar: Dark and Light (Esri gray canvas with a separate label overlay), Dark Satellite (Esri World Imagery, darkened in-shader, with boundary labels), Topographic (OpenTopoMap), and Earth — NASA's daily MODIS true-colour mosaic served by GIBS. The Earth basemap has a floating date navigator that steps one day at a time back to February 2000 (Terra) or July 2002 (Aqua), toggles the AM and PM passes, and rolls forward automatically across UTC midnight so an unattended display keeps showing the latest complete mosaic. Label overlays fade out below roughly 80 km of camera height so town names never sit on top of terrain at close range, and data layers are inserted beneath the labels so city names stay legible over weather.

**Rendering environment.** Cesium's stock chrome is disabled entirely. The globe renders in `requestRenderMode` over a transparent WebGL canvas with a deterministic 2D starfield behind it, real sun lighting for the day/night terminator, fog and atmosphere. An optional 3D Buildings & Terrain toggle streams Cesium World Terrain and the global OSM Buildings tileset with GPU memory capped at 192 MB plus 128 MB overflow. A Google Photorealistic 3D Tiles layer is wired but hidden from the UI and forced off on every load because the API is metered.

**Wall-display hardening.** Because the console runs unattended, a lost WebGL context triggers a full in-place viewer rebuild (up to four attempts), and if no working viewer appears within seven seconds the page reloads itself, bounded to three reloads per two minutes. A two-second watchdog also reloads when the GPU reports a lost context or when frames stall for more than eight seconds during a continuous screensaver render. A render-quality tier store and GPU auto-tune exist in the code but are no longer wired to any control — every device gets the highest-quality renderer.

**Layer pattern.** Every data layer follows the same recipe: a React component that owns one Cesium `CustomDataSource`, a Zustand status store the sidebar reads for its one-line status text, a visibility-aware poller that skips ticks while the tab is hidden, and panel metadata stamped onto each entity. A single global click handler drill-picks up to 16 overlapping features and either opens a docked panel or a "N features here" chooser.

**Panels and chrome.** Detail panels are draggable, resizable windows that snap into four dock zones; each panel body has its own error boundary so a malformed payload cannot blank the app. Below 768 px the windows become a swipeable bottom sheet. The top bar carries the live clock (local and UTC), a tracked-object counter with sparkline, camera reset, fullscreen, screenshot, the measure tool, the Status dashboard button, the Crisis button with its active-incident badge, the widget launcher (Property Watch, Breaking News, Intel Feed), search, and an information popover that documents the provider and trust basis of every active layer. The sidebar groups layer toggles into Base Map, Hazards & Alerts, Weather, Fire & Smoke, Tracking and Locations sections whose collapsed state persists.

**Search and measurement.** Search accepts a raw `lat, lon` pair or a place name (server-proxied Nominatim, five results, 24-hour cache). The measure tool computes geodesic distance, spherical polygon area and ellipsoid-corrected radius circles with keyboard shortcuts; terrain height is ignored.

**Screensaver and kiosk modes.** Four cinematic tours are built in — Global (curated geopolitical landmarks plus live M5+ earthquakes and NWS alerts), National Parks (seven stops with trivia and glowing park boundaries), ISS (SGP4-propagated follow camera), and Pins (an orbit of every monitored property and fleet ship with live hazard cards, a sonar ring for ships and a severity meter in the clock card) — plus a Hover mode that orbits any clicked point. Optional voice announcements use the Web Speech API. There is no idle-timeout auto-start; a mode must be chosen manually and is deliberately not persisted across reloads.

**Persisted client state.** Layer and basemap selections, sidebar collapse state, crisis dock width, voice preference and the GPU reload budget persist in the browser. Open panels, screensaver state, measure geometry and the Earth basemap date do not.

## The server

The server is one Express 4 process. It mounts 29 routers, serves the Vite build as static files, and starts seven background jobs at boot.

**Router families.**

| Family | Routers | Auth |
|---|---|---|
| Identity and admin | `/api/auth`, `/api/admin` | login/signup public; admin routes admin-only |
| Team records | `/api/incidents`, `/api/iap`, `/api/watchlist` | signed-in user (IAP upload/delete admin-only) |
| Crisis sharing | `/api/crisis` | publish/renew/revoke require sign-in; viewer reads are public behind a per-link password |
| OSINT | `/api/intel`, `/api/news`, `/api/news-map` | public |
| Hazard feeds | `/api/alerts`, `/api/earthquakes`, `/api/radar`, `/api/smoke`, `/api/aqi`, `/api/fire-outlook`, `/api/rivers`, `/api/lightning` | public |
| Movement and geography | `/api/flights`, `/api/ships`, `/api/satellites`, `/api/wind`, `/api/outages`, `/api/jtwc-invests`, `/api/geocode`, `/api/county`, `/api/park`, `/api/park-news`, `/api/directions`, `/api/drive` | public |
| Decision support | `/api/briefing` | public |

Two of those routers, `/api/directions` and `/api/drive`, are dead code: the client now calls Overpass and OSRM directly from the browser.

**The shared cache.** A single in-memory TTL cache backs almost every proxy route. It holds up to 2,000 live entries with insertion-order eviction, keeps a separate 500-entry "last good" map so a failed upstream refresh serves stale data instead of an error, and coalesces concurrent misses into one upstream call. The code is explicit that this is a single-dyno design and should be swapped for Redis before running more than one instance.

**Background collectors.** Seven jobs run regardless of whether any client is connected:

| Job | What it does |
|---|---|
| ADS-B tracker | Polls adsb.fi for a fixed roster of ten aircraft (10 s while a client is watching, else 60 s), maintains trails and takeoff/landing events, persists to Postgres at most every 30 s |
| AIS stream | Holds a WebSocket to aisstream.io filtered to the seven fleet vessels, with a by-IMO poller (CruiseMapper scrape by default, VesselFinder or MyShipTracking if a paid key is set) every 120 minutes |
| Lightning collector | Holds a WebSocket to Blitzortung relays, keeps one strike in six in a 3-million-slot ring buffer spanning 24 hours, and writes gzip'd five-minute chunks to Postgres |
| Rivers warmer | Refreshes the ~13 MB NWPS national gauge list every 15 minutes so `/api/rivers` never blocks on the ~50-second upstream pull; pauses after 30 idle minutes |
| Wind grid | Refreshes a 5-degree global GFS wind grid from Open-Meteo every 30 minutes and upserts it to Postgres; a baked-in grid guarantees a floor |
| Outage aggregator | Rebuilds an 18-source, multi-state outage picture every 4 minutes; pauses after 15 idle minutes |
| Intel ingest | Every 90 seconds fans out over seven built-in and every team-added watchlist source, normalises items, geocodes them under a budget, and keeps an 800-item / 36-hour rolling buffer |

**Live sync.** Two Server-Sent Events streams push changes: `/api/incidents/events` to signed-in editors and `/api/crisis/share/:token/events` to share-link viewers, each with a 25-second keepalive. Gzip compression is disabled for these streams because it previously held events in the zlib buffer. Client sets are in-process memory, so live sync assumes one dyno.

**Boot and resilience.** The process binds its port immediately, then runs schema migrations in the background with exponential backoff (six attempts). If Postgres is unreachable the globe and every non-database route keep working; only auth, incidents, crisis and watchlist error. Unhandled promise rejections are logged rather than fatal, async handlers on the main routers are wrapped to return a fast 503, and a final middleware turns any thrown error into JSON. Static assets under `/assets/` are content-hashed and cached for a year; `index.html` is never cached, and a request for a missing hashed chunk returns 404 rather than HTML so a stale tab cannot blank itself after a deploy.

## Data tier

The database schema is created by one idempotent migration script that re-runs on every boot. There is no migrations version table and no foreign keys.

| Table | Holds |
|---|---|
| `users` | id, email (unique), name, bcrypt password hash, role (`member` or `admin`), created_at |
| `settings` | key/value pairs: the current signup code and the IAP-seeded flag |
| `incidents` | one JSONB document per crisis incident (the whole record, images as Cloudinary URLs), plus timestamps |
| `share_links` | token, incident id, frozen snapshot JSONB, active flag, double-SHA-256 password hash, 72-hour `expires_at`, label, `revoked_at` |
| `share_access_log` | one row per viewer open: token, time, IP, user agent (indexed by token and time) |
| `watchlist_sources` | team-shared OSINT sources: kind, URL, label, JSONB config, active flag, added-by user |
| `lightning_chunks` | gzip'd five-minute strike chunks forming a 24-hour history that survives deploys |
| `snapshots` | small key/value JSONB blobs: the latest wind grid and the flights tracker state |
| `iap_documents` | Incident Action Plan PDFs as BYTEA, one per incident type plus a general default (15 MB cap) |

Persistence tiers differ by feed. Wind serves live → Postgres snapshot → baked-in fallback. Flights and lightning restore from Postgres on boot. The ship tracker persists only to a JSON file on the dyno's filesystem, which Heroku wipes on every deploy. The intel buffer and every cache are memory-only and start empty after a restart.

## Identity and access

Authentication is self-contained. Signing up requires a shared invite code (rotatable from the admin panel or pinned by an environment variable); the very first account becomes the admin and every later one is a member. Login issues a JSON Web Token carrying id, email, name and role, valid for 30 days, in an httpOnly, sameSite=lax cookie; passwords are hashed with bcrypt at cost 12. Tokens are verified by signature only — the user table is not consulted on later requests. An in-memory counter blocks login and signup after ten failures from one IP within ten minutes.

The admin panel lists and deletes users, rotates the signup code, and manages the IAP PDF library. There is no role promotion, password reset, email verification or multi-factor authentication.

Every live data-layer route and the public OSINT feed are unauthenticated. Share links are the only public door into team data, gated by a per-link 10-character password (the browser sends a SHA-256 of it as a query-string key), a 72-hour renewable expiry and a revocation stamp, with each open written to the access log.

## Configuration and deployment

All configuration is by environment variable. Only two are required in practice, and neither is documented in the repository's example file or Heroku manifest.

| Variable | Purpose | Required | Documented |
|---|---|---|---|
| `DATABASE_URL` | Postgres connection string | yes | no |
| `JWT_SECRET` | signs session cookies; every auth call fails without it | yes | no |
| `PORT`, `NODE_ENV` | set by Heroku; `NODE_ENV=production` enables the cookie's secure flag | platform | partly |
| `NWS_USER_AGENT` | identifying User-Agent for NWS, Nominatim, CelesTrak, adsb.fi | recommended | yes |
| `SIGNUP_CODE` | pins the invite code; re-applied on every boot, overriding admin rotations | no | no |
| `AISSTREAM_API_KEY` | free aisstream.io key; ships layer is empty without it | no | no |
| `VESSELFINDER_API_KEY`, `MYSHIPTRACKING_API_KEY` | optional paid by-IMO vessel positions | no | no |
| `SHIPS_SCRAPE_CRUISEMAPPER`, `AIS_MMSI_FILTER`, `SHIPS_POLL_MINUTES`, `SHIPS_SNAPSHOT_PATH` | ship tracker tuning | no | no |
| `AIRNOW_API_KEY`, `PURPLEAIR_API_KEY` | air-quality providers; layer is empty without them | no | no |
| `NPS_API_KEY` | park alerts/news; defaults to the rate-limited `DEMO_KEY` | no | no |
| `ANTHROPIC_API_KEY`, `BRIEFING_MODEL` | enables the AI duty-officer briefing; rules digest otherwise | no | no |
| `VITE_CESIUM_ION_TOKEN` | build-time; terrain and buildings fall back to Cesium's rate-limited demo token | no | no |
| `VITE_GOOGLE_MAPS_KEY` | build-time; hidden photorealistic 3D layer | no | no |

Deployment is a single Heroku dyno via the Node buildpack: `npm install`, `npm run build` (Vite build, then TypeScript compile), `npm start`. The `app.json` manifest declares the buildpack and one basic web dyno but no Postgres add-on. Continuous integration runs on every push — install, typecheck of both workspaces, Vitest in both workspaces, and a full build — with no Postgres service and no deploy step.

**Test coverage.** Twenty-two unit-test files exist: five on the server (cache, checklist validator, incident taxonomy, aircraft-info parsing, flight state machine) and seventeen on the client (crisis store and sync canonicalisation, AAR metrics, checklist and intake templates, layer measurement, flight markers, fuel reference, POI classifier, directions client, geodesy, measure math, and the wildfire risk report's level algebra). Nothing exercises an HTTP route end to end, authentication, migrations, or any map layer component.

## Extension model

The README's five-step recipe for adding a layer still describes the shape of the code: add a layer id to the client types, add a `CustomDataSource` component under `client/src/layers/`, register a detail component in the panel router, add a proxy route under `server/src/routes/`, and add a sidebar toggle. Two details in the README no longer match the code: zone-based NWS alerts are resolved to county polygons in the browser from a static county file, not server-side, and flights are tracked from a fixed server-side roster rather than refreshed from the camera viewport.


# Threat Monitoring

GSOC Monitor watches eleven threat domains and fuses them into property-centric judgments for a duty officer. Every domain follows one pattern: a CesiumJS layer toggled from the sidebar, a one-line status readout, click-to-open detail panels, and polling that pauses while the browser tab is hidden. Feeds that pass through the Express server share one in-memory TTL cache with stale-on-error and request coalescing (`server/src/cache.ts`), so a provider outage degrades to the last good value rather than an empty globe. Several feeds (NWS alerts on the primary path, FIRMS hotspots, NIFC incidents, NHC storms, LANDFIRE tiles, live lightning) are fetched directly from the browser with no server involvement. This chapter describes each domain as it exists in the code: what is monitored, what the operator sees, how fresh it is, and where coverage stops.

## Severe weather

Four layers cover convective and synoptic weather: NWS alert polygons, RainViewer radar and infrared satellite, the WPC precipitation forecast raster, and a global surface-wind field.

### NWS alerts

"NWS Alerts" (on by default) draws every active National Weather Service watch, warning and advisory as a translucent polygon. Storm-based warnings carry their own geometry; alerts that ship with `geometry:null` are resolved on the client by matching their SAME county codes against a static ~3,200-county FIPS GeoJSON loaded once per session from a Plotly-hosted GitHub mirror. Zone-only alerts without SAME codes (marine and fire-weather zones) draw nothing, and polygon holes are dropped.

Colour is by hazard type first, roughly fifteen hues: tornado, tsunami, extreme wind, flash flood, storm surge, tropical, the flood family in blues, thunderstorm yellows, fire and red-flag orange, heat, winter lavenders, wind, marine teal and air-quality browns. Unmatched events fall back to severity (Extreme red, Severe orange, Moderate yellow, Minor blue), and polygons are sorted so the most severe draws on top. There is no on-map colour key.

Clicking a polygon opens a panel with headline, severity, urgency, certainty, issuing office, effective and expiry times, area description, description and instructions; the open alert brightens and a chooser lists stacked alerts. The browser fetches `https://api.weather.gov/alerts/active` directly every 60 s with a 20 s timeout, falls back to `/api/alerts/active` (60 s server cache, `NWS_USER_AGENT` header) on failure, and prefers the proxy for 10 minutes before retrying direct. An alert-id signature skips redraws when nothing changed. <span class="tag">production</span> <span class="sev info">free</span>

### Precipitation radar and IR satellite

"Precipitation Radar" loads the RainViewer frame manifest through `/api/radar` (2-minute server cache, 2-minute client poll) and stacks one imagery layer per frame. Tiles are never proxied: the browser pulls 512 px PNGs from RainViewer's CDN, capped at zoom 9 for radar and 6 for infrared. Playback runs at 800 ms per frame with a 720 ms crossfade, looping from the observed window into RainViewer nowcast frames. A bottom-centre timeline offers play/pause, a scrubber spanning observed and forecast (hatched amber), a "now" divider and a readout such as "+20 min" or "forecast +1h 10m".

Sidebar controls set the mode (Radar, Clouds, Combined), the observed window (30, 60 or 120 minutes; default 120, the last twelve ten-minute frames), four palettes (Storm, Classic, Blue, Mono) and opacity. Because the RainViewer CDN ignores its colour-scheme path segment, tiles are recoloured client-side through an inversion lookup, a zoom-scaled seam-hiding blur and a per-palette alpha LUT; this is a documented workaround that still ships a temporary `/api/radar/diag` probe. Combined mode pairs each radar frame with its nearest IR frame within 60 minutes but is not the default pending calibration. <span class="tag">production</span> with Combined mode <span class="tag">partial</span>

### WPC precipitation forecast

"Precipitation Forecast (WPC)" renders Weather Prediction Center QPF accumulation polygons as live ArcGIS export tiles clipped to CONUS at up to zoom 9. Sub-controls choose 24 h, 48 h, 72 h (default) or 5-day accumulation and an opacity slider (default 0.75). A floating legend reproduces the exact 18-stop WPC ramp from 0.01 in to 20+ in. There is no app cache and no error latch: every tile is a live render and a NOAA outage shows as blank tiles. The product is issued twice daily at 06Z and 18Z. <span class="tag">production</span>

### Global wind field

"Wind (GFS)" advects 7,000 particles on the CPU at about 30 fps through a bilinearly interpolated global 10 m wind grid, each trailing eight history slots (63,000 point primitives), lifted 3 km above the ellipsoid and coloured on an eight-stop ramp from calm blue to red/magenta across 0–45 m/s. "Wind Streamlines" integrates the same field 18 steps forward from a camera-adaptive seed grid (at most 1,600 lines) into glowing polylines with surface-tangent arrowheads that point the true way under any camera tilt, rebuilt on every camera stop.

The wind probe (off by default) adds a cursor-following arrow and a HUD card with compass, speed in all three units, "from WSW 247°", "Calm" under 0.5 m/s and a HISTORICAL badge when the grid is stale. Right-click drops a persistent pin; left-clicking a pin opens a "Wind forecast" panel with a now headline (sustained, gusts, direction), peak-gust callout, a 48-hour hourly bar chart with gust ticks and direction arrows, and a 7-day outlook strip of daily max speed, gust and dominant direction.

The grid is 72 × 33 points at 5 degrees (2,376 points, latitude ±80) fetched from Open-Meteo GFS in five batches of 500. The server refreshes it every 30 minutes, upserts it into the Postgres `snapshots` table so a redeploy restores real wind, and falls back to a committed baked grid; anything older than 45 minutes is flagged stale. The client refetches every 30 minutes and hydrates instantly from an ~80 KB localStorage copy. Point forecasts come from `/api/wind/forecast` (Open-Meteo, 7-day hourly, 30-minute cache at 0.1-degree rounding) with a 10-minute circuit breaker to MET Norway. The 5-degree grid is coarse; the implementation plan calls it too coarse for further environmental fields. <span class="tag">production</span>

## Wildfire, smoke and air quality

Six layers cover fire end to end: satellite heat detections, named incidents, the seven-day outlook, smoke plumes, fuel models with a draw-a-zone analyzer, and air quality.

### FIRMS VIIRS hotspots

"Wildfires (NASA FIRMS)" draws past-24 h VIIRS 375 m thermal detections from the Esri Living Atlas FeatureServer, fetched directly by the browser. In viewport mode the query covers the camera rectangle, capped at the 2,500 strongest detections by Fire Radiative Power, and re-runs on camera stop (800 ms debounce) and every 5 minutes. Flame billboards are sized and coloured by FRP tier: extreme at 100 MW or more, high at 30 MW, medium at 8 MW, low below. "Near pins" switches to one envelope query per property group filtered to 5, 50, 100 or 200 miles of an actual pin; the same function feeds Property Watch and the risk report, so map and watch list always agree.

The detail panel grades each detection from FRP and I-4 brightness temperature: "Intense fire front" at 75 MW or more (or a saturated 366.5 K pixel with FRP 30 or more), flaming at 15 MW or saturation, active at 3 MW or 345 K, smouldering at 0.8 MW or 325 K, otherwise weak or residual heat. It shows pixel temperature, confidence, satellite, day/night pass, local detection time with a UTC tooltip, and a caveat that a detection is a heat signature, not a confirmed wildfire. Global coverage; no on-map legend. <span class="tag">production</span> <span class="sev info">free</span>

### Named incidents and perimeters (NIFC/WFIGS)

"Named Fires (NIFC)" fetches current interagency incidents directly from the WFIGS ArcGIS services every 5 minutes: wildfires of 5 acres or more under 100 percent containment (largest first, at most 800) plus perimeters for incidents of 100 acres or more (at most 500, simplified to roughly 800 m). Markers are flame-in-ring glyphs coloured by containment (under 30 percent or unknown red, under 70 orange, under 100 yellow, contained grey) with a "Name · 12k ac" label hidden beyond 4,000 km. A perimeter failure never blocks the markers. The panel shows a containment badge and progress bar, acres, personnel, complexity, managing organisation, cause, discovery date, location and an InciWeb link. Perimeters are not clickable and are not linked to their marker. <span class="tag">production</span>

### 7-day fire potential (NWCG)

"7-Day Fire Potential (NWCG)" shades each of about 234 Predictive Service Area polygons for the selected day with the official palette: IGNITION red and CRITICAL orange override fuel dryness, otherwise Very dry, Dry, Normal or no data. The server queries seven MapServer layers (Day 1 with geometry, Days 2–7 attributes only) and caches 2 hours; the client polls every 30 minutes and the seven day buttons re-render instantly from the cached payload. Clicking a PSA shows category, day and date, significant potential, dryness, GACC and PSA code with an NWCG link. This is the one hazard layer with a floating legend. CONUS only. <span class="tag">production</span>

### Smoke plumes (NOAA HMS)

"Smoke (NOAA HMS)" draws the analyst-delineated plumes from the Hazard Mapping System daily KML, filled by density (Light, Medium, Heavy on top). The server downloads today's UTC file, falling back to yesterday and the day before when missing or empty, and caches 2 hours; the client polls every 2 hours. The panel gives density with an impact sentence, satellite, start and end times and product date. Polygons are ellipsoid-draped rather than terrain-classified after Cesium crashes. The product can be up to two days old; coverage is North America. <span class="tag">production</span>

### Fuel models and the Fuel Analyzer (LANDFIRE)

"Fuel Models (LANDFIRE)" renders the LF2024 Scott and Burgan FBFM40 raster (30 m, CONUS, up to zoom 16) as live USGS ImageServer tiles at 0.72 alpha with the official colormap. The 45-class codebook (91–99 nonburnable, 101–204 burnable) rolls up into seven groups, Grass, Grass-Shrub, Shrub, Timber-Understory, Timber-Litter, Slash-Blowdown and Nonburnable, which the floating FBFM40 legend shows as swatches.

The Fuel Analyzer lets the operator draw a circle (centre, then radius, clamped 150 m to 250 km) or a polygon. The ring is POSTed from the browser to the ImageServer `computeHistograms` endpoint and the 256-bin histogram is decoded with an affine bin-to-value mapping into exact per-class pixel counts. The result panel reports area (900 m² per cell), burnable percentage, per-class and per-group shares, and an app-defined 0–100 fire-behaviour potential score (Low under 20, Moderate under 40, High under 60, Very High under 78, else Extreme) with spread and flame-length categories and up to three driver strings. Tapping a model pins the published RMRS-GTR-153 reference card with adjective rate-of-spread and flame-length classes and NWCG Fireline Handbook suppression bands. The score tables are app heuristics at standard fire weather (10 mph 20-ft wind, 5 percent 1-h fuel moisture) with no live wind or moisture adjustment. The risk report reuses the same analysis on a 3 mi circle. CONUS only. <span class="tag">production</span>

### Air quality (AirNow + PurpleAir)

"Air Quality (AirNow + PurpleAir)" draws CONUS stations from `/api/aqi`: AirNow reference monitors as numbered badges in the EPA category colours and PurpleAir community sensors as plain dots. The server fetches both in parallel. AirNow supplies hourly PM2.5, O3, PM10, CO, NO2 and SO2 observations over a 3-hour window inside the bounding box -130,20 to -60,55, grouped per station with the highest-AQI pollutant dominant. PurpleAir supplies outdoor sensors reporting within the hour, dropping confidence under 70, then the EPA Barkjohn 2021 correction PM2.5 = 0.524 × cf1 − 0.0862 × RH + 5.75 (RH defaults to 35) and the 2024 PM2.5 breakpoints, stride-sampled to at most 6,000 sensors. The merged result is cached 15 minutes and polled every 15 minutes. Category is derived client-side from the number using the 50/100/150/200/300 breakpoints so colour always matches the value; per-source toggles filter without a refetch. The panel lists all pollutants worst-first for AirNow, and corrected PM2.5 with raw cf_1, humidity and confidence for PurpleAir, marked as an estimate. Both `AIRNOW_API_KEY` and `PURPLEAIR_API_KEY` are required and neither is documented in the env templates; without them the layer shows only a "set key" hint. <span class="tag">production</span> <span class="sev medium">key required</span>

## Seismic

"Earthquakes (USGS)" (on by default) draws each event as concentric ripple rings sized and coloured by tier: major M6+, strong M4.5+, moderate M2.5+, minor, depth-tested so far-side events are hidden. The server proxies the USGS summary feeds at `/api/earthquakes?magnitude=&period=` (magnitude in significant, 4.5, 2.5, 1.0, all; period in hour, day, week) with a 60 s cache. Sidebar buttons M1.0+, M2.5+, M4.5+ and Significant set the magnitude (default 2.5, persisted). The period exists in state and scales the poll (60 s hourly, 5 min daily, 15 min weekly) but has no UI, so operators are locked to the past day and cannot choose "all". The panel shows magnitude coloured by tier, place, time, depth, felt reports, tsunami flag, review status and a USGS link; the PAGER alert level in the feed is not displayed. Global coverage. <span class="tag">production</span> with the period filter <span class="tag">partial</span>

## Tropical and lightning

### Tropical cyclones

"Hurricanes (NHC + JTWC)" (on by default) polls every 5 minutes and draws, per storm, the forecast error cone (white at 10 percent), the observed track in solid grey, the forecast track in dashed amber, forecast position dots tinted by predicted Saffir-Simpson category, and a spiral eye glyph that rotates once every 5 s (counter-clockwise north of the equator). Storms are keyed by basin plus number so a rename from "Nine" to "Imelda" does not duplicate markers. Hovering a forecast dot shows name, category, "Forecast +48h" or "Current position", advisory time, and max wind and gusts in mph and kt; the panel adds position, gusts, minimum pressure, basin, advisory date and an NHC link. Classification uses the 64/83/96/113/137 kt thresholds with codes for potential, post-tropical, remnant and subtropical systems.

Beneath the storms, NHC and CPHC Graphical Tropical Weather Outlook "Potential Development Region" polygons are coloured by 7-day risk (Low yellow, Medium orange, High red) with the 7-day probability as a label; clicking shows 48-hour and 7-day formation-odds bars. For other basins, invests such as "96W" are parsed server-side from the JTWC ABPW10 and ABIO10 text bulletins (`/api/jtwc-invests`, 1-hour cache, an empty set rather than an error when both fail) and drawn as a roughly 100 NM ellipse coloured by development potential. NHC and GTWO data are fetched directly from Esri and NOAA ArcGIS services with no server cache, so every open dashboard and share-page viewer issues five or more queries every 5 minutes. Wind radii, advisory text and watches/warnings are not rendered. <span class="tag">production</span>

### Lightning

"Lightning (Blitzortung)" opens a WebSocket from the browser to a Blitzortung relay (ws1, ws7 or ws8, rotating on failure), subscribes with `{a:111}` and LZW-inflates each frame. Each strike drops a crosshair that steps white to yellow at 3 minutes, orange at 6, red at 9 and expires at 10, capped at 2,500. Strikes in view get a bolt animation descending from 120 km with a 12 km impact ring, up to 80 at once. The sidebar shows strikes per minute.

Window buttons for 1 h, 6 h, 12 h and 24 h enable the history layer, which polls `/api/lightning?minutes=` every 30 s and renders older strikes as points coloured by age (under 1 h yellow, 6 h orange, 12 h red-orange, 24 h magenta). The server runs its own persistent collector on the same relays: it keeps every sixth strike in ring buffers of 3,000,000 slots (about 48 MB, sized for roughly 200 strikes/s over 24 hours), writes gzip chunks to the Postgres `lightning_chunks` table every 5 minutes, deletes chunks older than 25 hours, restores the last 24 hours at boot and flushes on SIGTERM. Queries clamp to 1–1,440 minutes, thin to at most 20,000 points, and accept a lat/lon/radius filter (up to 500 mi) applied before the cap so local storms arrive unthinned; identical queries are memoised 10 s. A legend keys the history dots and the live age ramp, and `/api/lightning/debug` reports buffer fill. Because the buffer is a one-in-six sample, "N strikes in the last 6h" is a sample count. Live strikes are not clickable. Global coverage. <span class="tag">production</span>

## Flood

"Rivers & Floods (NWPS)" renders the NOAA National Water Prediction Service gauge list, about 12,700 points, coloured by observed flood tier: Major purple, Moderate red, Minor orange, Action yellow, Normal cyan, Low tan, unclassified grey, largest to smallest. Filter chips All, Action+, Minor+, Mod+ and Major and a "Highlight forecast-to-flood" toggle (enlarged, white-outlined points for gauges forecast to climb a tier) re-render without refetching; the sidebar reads "N at/above action · M shown".

The server refreshes the ~13 MB NWPS bulk list every 15 minutes in the background with a 90 s upstream timeout, never on the request path, drops out-of-service and stale gauges, and serves a pre-serialised buffer with per-tier counts; the loop pauses after 30 minutes without a client, and a cold start answers `warming:true` so the client re-polls after 12 s, otherwise every 15 minutes. Clicking a gauge fetches `/api/rivers/:lid` (10-minute cache): stage or flow with tier colour and a Rising/Falling/Steady trend, a threshold bar from normal through action, minor, moderate and major with current and forecast-crest markers, a 14-day observed (160 points) plus forecast (80 points) hydrograph with hover crosshair, up to six NWS impact statements near the current level, recent and record crests, county and state, USGS link and forecast-reliability notes. There is no alerting when a gauge crosses a tier. US coverage. <span class="tag">production</span>

## Infrastructure: power outages

"Power Outages (Multi-State)" draws each outage from `/api/outages` as a bolt-in-ring marker, red for Unplanned, amber for Planned, grey for unknown, with a "Utility · 1.2k" customer label inside 1,500 km. The panel shows type and status, customers affected, an aggregation note when a marker clusters several outages, utility and state, start time with elapsed age, estimated restoration ("in 2h 15m" or red "overdue 30m"), area and cause.

The server normalises 18 sources of three kinds. Five ArcGIS FeatureServers: Cal OES (CA), Salt River Project (AZ), SSVEC (AZ), Minnesota Power / SWLP (MN) and Riverside Public Utilities (CA). Nine KUBRA Storm Center instances, walked quadkey by quadkey from zoom 7 with a cap of 150 tiles or 25 s per utility and unrefined clusters emitted as aggregated points: Oncor (TX), Georgia Power (GA), JEA (FL), Colorado Springs Utilities (CO), Cobb EMC (GA), LG&E / KU (KY), Evergy (KS), Versant Power (ME) and Appalachian Power (VA). Four NISC co-op tenants: Sawnee EMC (GA), SLEMCO (LA), Price Electric (WI) and Cloverland Electric (MI). Those sources carry 14 distinct state labels; the panel footer quotes roughly 19 states because several territories cross state lines. The aggregate is rebuilt every 4 minutes with each source caught independently and paused after 15 minutes without requests; the client polls every 5 minutes and retries after 20 s on "warming up". Coverage is far from national (PNM and Louisiana GOHSEP are deliberately excluded), the KUBRA GUIDs are hard-coded and may rotate, outages are points with no extents, and the per-source `sources[]` status the API returns is not shown in the UI. <span class="tag">partial</span>

## Aviation

"Flights (ADS-B)" tracks a fixed roster of ten tails anywhere on the globe, polled by registration from adsb.fi on the server: three company aircraft (N10AZ, N14NA, N154LA), three NOAA hurricane hunters (WP-3Ds N42RF "Kermit" and N43RF "Miss Piggy", Gulfstream IV-SP N49RF "Gonzo") and four 10 Tanker DC-10s (N17085, N522AX, N603AX, N612AX; Tankers 910, 911, 912, 914). Company tails poll every 10 s while a client has hit the route in the last 5 minutes (60 s otherwise) and are held at last-known position forever, so a parked jet stays on the map. The special rosters poll every 60 s, appear while flying and for 2 hours after the last fix, then clear until the next mission. USAF WC-130J hunters cannot be tracked because they fly military hexes under mission callsigns.

Each aircraft is a roster-specific silhouette (business jet, four-engine turboprop, wide-body tanker) rotated to ground track inside a pinging reticle with a registration and airframe nametag, tinted on the tar1090 altitude rainbow (orange at 2,000 ft, green at 10,000 ft, magenta at 40,000 ft); grounded aircraft turn slate grey, and after 180 s without a fix an aircraft is clamped to the ground and dimmed. Trails are altitude-coloured polylines fading toward the oldest fix with direction chevrons every 30 km and a break rather than a chord at gaps over 15 minutes; the server keeps 24 h for company tails and 2 h for specials (2,500 points, decimated to 700 on the wire).

Every grounded-to-airborne transition becomes a takeoff or landing event after a 2-minute confirmation hold; 200 are retained and the four most recent appear in the sidebar resolved to a nearby city ("N10AZ ↑ departed near Denver, CO · 09:41"). The panel shows callsign, registration, a Planespotters photo with credit, make and marketing model plus ICAO type from adsbdb, operator, altitude, ground speed, heading, vertical rate, squawk and last seen, reading the live poll so a parked jet never opens a frozen panel; enrichment refreshes every 7 days. Positions, trails, airframe data and events are upserted to the Postgres `snapshots` key `flights:v1` at most every 30 s and restored at boot. The client polls every 10 s; checkboxes filter the three roster groups. The roster is hard-coded with no UI to add tails. <span class="tag">production</span> <span class="sev info">free</span>

## Maritime

"Ships (AIS)" tracks the seven Windstar Cruises vessels, Star Breeze, Star Legend, Star Pride, Star Seeker, Wind Spirit, Wind Star and Wind Surf, by MMSI and IMO. Each is a sonar-contact marker: a bracket reticle, a hull silhouette rotated to true heading (falling back to course) and pinging range rings, coloured by AIS ship type and fading after 20 minutes and again after 2 hours without a report. "Show past & future paths" adds the 72-hour trail (fixes 75 m apart, at most 400 points) and a dashed 6-hour dead-reckoning projection along course at current speed above 0.5 kt. The client polls `/api/ships` every 30 s.

Positions merge freshest-wins from two paths. A persistent server WebSocket to AISStream (free `AISSTREAM_API_KEY`, filtered to the fleet MMSIs) receives reports whenever a ship is within a community receiver's range; code comments record that in practice it never saw the fleet across 150,000 messages. The by-IMO poller, every `SHIPS_POLL_MINUTES` (default 120, minimum 15), therefore does the real work: a CruiseMapper ship-page scrape behind Cloudflare by default, or VesselFinder (roughly 2,500 credits a month at the default cadence) or MyShipTracking when a key is set, both <span class="sev high">paid</span>. Positions persist to a dyno-local JSON snapshot that survives restarts but is wiped on every deploy; ships stay at last-known position with no staleness cutoff.

The panel shows a rotating wireframe class card with a hand-entered spec grid, then IMO, MMSI, type, call sign, decoded navigation status, speed, heading, course, destination, ETA and AIS age with an amber "showing last known position" warning after 20 minutes. The sidebar roster lists all seven with live speed and flies to any ship; its status line diagnoses the feed and points to `/api/ships/debug`, which reports socket state and scrape blocks such as "3/7 requests blocked (Cloudflare HTTP 403)". "Copy fleet snapshot" renders a 1,520 px PNG with a Natural Earth coastline map, 72 h tracks, class-coloured markers, callout chips geocoded from the browser via BigDataCloud ("142 nm NE of Suva, Fiji") and a table of status, position, speed, destination, ETA (UTC and Denver) and last fix, copied to the clipboard and downloaded as `windstar-fleet-YYYY-MM-DD.png`. Fleet identity is duplicated in three hand-synchronised places. <span class="tag">partial</span>

## Space

"Satellites (CelesTrak)" loads two-line element sets for one of five groups, Space Stations, Brightest, GPS, Weather or Starlink, from `/api/satellites?group=` (2-hour server cache) and propagates every satellite in the browser with satellite.js SGP4 on a tick of 250 ms (up to 200 satellites), 800 ms (up to 800) or 1,500 ms, paused while hidden. A cap of 2,500 truncates Starlink; labels show only when 40 or fewer are drawn, and the ISS always keeps a gold glyph and label. Groups of 500 or fewer drag a fading trail, and the selected satellite gets a full-revolution orbit ring of 160 SGP4 samples recomputed every 8 s with the far half occluded by the globe. The panel re-propagates every second to show latitude, longitude, altitude, speed, and period, inclination, apogee and perigee derived from mean motion, plus NORAD and international designators. "Track the ISS" enables the layer, selects the stations group and flies to NORAD 25544 at 5,000 km with a -35° pitch. TLEs are fetched once per toggle and never refreshed while the layer stays on. <span class="tag">production</span> <span class="sev info">free</span>

## Open-source intelligence

Three server pipelines feed the OSINT picture: a Breaking News RSS aggregator, a GDELT geocoded news map, and a Dataminr-style Intel Feed with a team-shared watchlist.

### Breaking News

`/api/news` fetches five hard-coded world feeds, BBC News World, The Guardian World, Sky News World, NPR News and Al Jazeera, caches the merged set 5 minutes, serves the last good set through a 60 s cooldown on total failure, and caps at 120 stories. Each story is scored critical (killed, explosion, shooting, tsunami, hostage and similar keywords), urgent (warning, evacuation, flood, wildfire, missile, protest) or alert; categorised by regex into conflict, disaster, weather, politics, economy, health or environment; and geolocated by a static gazetteer of about 45 hotspot cities and 50 country centroids with no geocoder, so most headlines get no coordinates. The widget polls every 5 minutes with severity and category chips, thumbnails, a NEW badge for unseen ids, and a Sources section where users add RSS URLs stored per browser and sent as `?extra=` (those URLs receive no public-host validation). A "Park News" mode swaps to `/api/park-news`, NPS alerts and releases for six tracked parks on a 10-minute cache, and a bottom ticker shows the same stream whenever the panel is closed. The widget's registry subtitle still says "GDELT · live feed" although the data is RSS. <span class="tag">production</span>

### GDELT news map

`/api/news-map` queries the GDELT GKG GeoJSON v1 endpoint with a default security query (protest, evacuation, wildfire, shooting, explosion, flooding, active shooter, lockdown, hazmat, riot, derailment) over the last 6 hours, at most 250 rows, and groups the result into one pin per location with article count, average tone, a representative image and up to six links titled from URL slugs, cached 10 minutes per query-and-timespan bucket. The pin layer draws a newspaper glyph sized by count and turned red when average tone is -5 or lower. In the operator console the layer is forced off on every store hydration and mounts only on crisis share-link globes; operators see GDELT only through the dashboard's News metric and feed events. <span class="tag">partial</span>

### Intel Feed

The intel engine runs a cycle every 90 s over seven built-in sources plus every active row of the Postgres `watchlist_sources` table: a "National Park Alerts" Google News search and two regional searches pinned to the Yellowstone and Grand Canyon regions, a Bluesky "wildfire evacuation" keyword search, the PulsePoint San Francisco Fire/EMS CAD (agency EMS1384, decrypted from a reverse-engineered web-app endpoint), the California CHP statewide dispatch XML, and the City of Chicago crime dataset on Socrata. Every item is normalised into one shape with a keyword-regex severity of info, watch or urgent and a category among scanner, crime, crash, fire, weather, news, social and other. Items with a place string but no coordinates (PulsePoint medical calls, CHP road locations) are geocoded through OSM Nominatim under a budget of 16 new lookups per cycle spaced 1.1 s apart, cached 30 days, with confirmed misses blacklisted. The rolling buffer is capped at 800 items or 36 hours, served publicly at `/api/intel` with no authentication, and lost on every restart.

The Intel Feed widget polls every 90 s and lists up to 150 rows with severity dot, category chip, source, age and author; clicking flies to a geolocated item at 120 km or opens its URL. Any signed-in member can add a team-wide watchlist source from seven presets: RSS URL, Google News topic, Bluesky account, Bluesky keyword, PulsePoint agency id, Socrata domain plus dataset id, or CHP dispatch, with an optional place pin that the server geocodes into a region. Rows are validated per kind (RSS hosts must be public, no IP literals or `.local`, re-checked after redirects), the table is capped at 100 sources, and sources can be paused, resumed and deleted. On-globe intel pins (category-tinted circles, red-ringed for urgent) are, like GDELT, forced off in the operator console and render only on share pages. All kinds share the single 90 s cadence, there is no push alerting, and severity is keyword matching rather than NLP. <span class="tag">production</span> with map pins <span class="tag">partial</span>

## Decision support

Four surfaces turn the raw feeds into judgments about the monitored estate: 13 property groups holding 31 locations (Glacier NP 5, Death Valley 2, Grand Canyon 6, Corporate Offices 2, Centennial Airport 1, Yellowstone 8, Mt. Rushmore 1, Windstar Cruises office 1, Holiday Vacations 1, VBT Bicycling 1, Sea Island 1, Cog Railway 1, Rocky Mountain NP 1), hard-coded in `client/src/layers/locations/locations.ts`, plus the seven-ship fleet.

### Property Watch

The "Watch" widget runs a proximity scan at 25, 50 or 100 mi (default 25). It fetches in parallel the FIRMS hotspots near pins (13 padded envelopes), NWS active alerts with the county GeoJSON, and USGS M2.5+ earthquakes from the past week, then for each of the 31 locations lists hotspots within the radius nearest-first with FRP, quakes nearest-first with magnitude tiers, and alerts whose polygon contains the point, sorted by severity. Only properties with at least one hazard are returned, ranked by worst alert severity then nearest physical hazard. The widget polls every 5 minutes and the shared store throttles to one scan per 60 s. The status line reads "FIRMS + NWS + USGS - live" or names the feeds that are down, and the all-clear banner is suppressed when every feed has failed. A per-property pop-out polls on its own 5-minute interval, lists active alerts, up to eight nearby fires and eight recent quakes, and offers Fly to, Risk (the wildfire report) and Export, which draws a 560 px 2x canvas report and downloads `<slug>_watch_<YYYY-MM-DD>.png`. A ticker shows the live global lightning rate when that layer is on. <span class="tag">production</span>

### Property Status Dashboard

The TopBar "Status" button opens a full-screen overlay listing every group as a card sorted alert, watch, ok; while open it rescans every 300 s and never overlaps a slow scan. Status derives from the 100 mi scan: alert when the worst NWS alert covering any location has severity rank 3 or higher (Severe or Extreme) or the nearest FIRMS hotspot is under 25 mi; watch when any alert is in effect, a hotspot is within 100 mi, or an M2.5+ quake from the past week is within 100 mi; otherwise ok. Each card shows active alerts with expiry countdowns (red at 30 minutes or less), Open-Meteo temperature and wind for the group's primary location, 7-day forecast rain, the nearest AQI station within 75 mi, nearest hotspot, nearest quake, GDELT events within 150 mi and the nearest outage within 100 mi. Clicking a card flies to the group.

A right-hand live feed holds up to 120 deduplicated events of seven types: alert, fire, quake, news (up to four per group), outage, storm (tropical systems within 250 mi of a property or 300 mi of a fleet ship, from NHC observed positions plus JTWC invests) and ais ("AIS signal silent for Nh" when a fleet ship has been quiet for more than 6 hours). Clicking an event flies to it. The storm watch and AIS-silence checks are the least hardened parts; the NHC sublayer index previously returned zero storms silently. The dashboard scans only while open, keeps no history, and resets its feed on reload. <span class="tag">production</span>

### The threat score

`threatScore.ts` computes a per-group 0–100 score as the sum of additive contributions, rounded and clamped to 100, with the top three reasons attached:

| Signal | Contribution |
|---|---|
| NWS alerts | base 45 if worst severity rank ≥ 4 (Extreme), 35 if ≥ 3 (Severe), 18 if ≥ 2 (Moderate), else 8; plus min(12, (alert count − 1) × 4) |
| Nearest hotspot | 30 if < 10 mi, 22 if < 25 mi, 12 if < 50 mi, else 6 (within the 100 mi scan) |
| Nearest earthquake | 15 if magnitude ≥ 5 and < 50 mi, 8 if magnitude ≥ 4, else 4 |
| Nearest outage | 10 if < 25 mi else 5, plus 5 if customers > 1,000 |
| Air quality | 8 if AQI > 150, 4 if AQI > 100 |
| 7-day forecast rain | 6 if ≥ 3 in, 3 if ≥ 1.5 in |
| Current wind | 6 if ≥ 35 kt, 3 if ≥ 25 kt |

Severity ranks are Extreme 4, Severe 3, Moderate 2, Minor 1, Unknown 0. The score chip is red at 60 or more, orange at 35, yellow at 15 and green below; it is hidden at zero and shows its reasons on hover. The weights are constants in code with no per-tenant configuration and are described in the source as deliberately simple and explainable rather than calibrated.

### The duty-officer briefing

At the top of the dashboard, the briefing panel shows a headline, two or three paragraphs, a source tag ("AI - <model>" or "automated digest"), a time and a Refresh button. The client fuses the current scan into a signals payload (each group's level, score, reasons, up to three alerts, nearest fire, outage, weather, rain and AQI, sorted by score, plus the twelve most recent feed lines) and POSTs it to `/api/briefing`, throttled to once per 9 minutes unless forced. With `ANTHROPIC_API_KEY` set the server calls the Anthropic SDK with model `BRIEFING_MODEL` (default `claude-opus-4-8`), 700 max tokens and a system prompt demanding a headline of 12 words or fewer followed by 100–180 words grounded strictly in the JSON, treating payload text as data. Without a key, or on any API error, a deterministic rules digest is composed instead ("All properties nominal" or "N properties elevated - highest: X", listing groups scoring 15 or more with their reasons). Responses are cached 10 minutes by SHA-1 of the payload minus its timestamp, up to 20 keys; payloads are limited to 40 groups and 30,000 characters. "Top concerns" chips fly to up to three groups scoring 15 or more. <span class="tag">production</span> <span class="sev high">paid</span> on the AI path

### Property Wildfire Risk Report

From a property pop-out, "Risk" opens a full-screen "Property Risk Report - Wildfire"; only the wildfire hazard is implemented. Assembly fetches eleven feeds in parallel with independent failure, so a down feed becomes an "Unavailable" section excluded from the overall level rather than a silent Low: FIRMS hotspots at 100 mi, NIFC incidents and perimeters, NWS alerts filtered to red flag, fire weather, fire warning, extreme fire, smoke and evacuation and point-tested at the site, county geometry, the NWCG 7-day outlook, a LANDFIRE zonal analysis on a 3 mi circle (CONUS only), the 48-hour wind forecast, the 10-day daily forecast, HMS smoke (North America only), 24 hours of Blitzortung strikes within 130 mi, and a WPC QPF identify at the point. A loading console draws the real rings as a radar scope and flips twelve feed rows to LOCK, DOWN or SKIP as each fetch settles.

Exposure is measured at four fixed rings: 1 mi "Evacuation / direct impact", 5 mi "Mutual aid - staging - access", 25 mi "Supply - staff commute" and 100 mi "Logistics - alternate lodging". Eight sections are rated on a five-level scale of low, guarded, elevated, high and critical, and the overall level is the maximum of the available sections. Hotspots: nearest within 1 mi critical, 5 mi high, 25 mi elevated, else guarded, bumped one level if any hotspot within 25 mi exceeds 100 MW. Named fires: an incident under 50 percent contained within 25 mi is high, otherwise elevated, bumped at 1,000 acres or more, with a staleness warning when the WFIGS record is 24 hours old; all contained at 50 percent or more is guarded. Alerts: red flag, evacuation, fire warning or extreme fire is high, fire weather elevated, other guarded. Outlook: CRITICAL today is high, IGNITION elevated, dryness 2 or more guarded. Fuel: zonal score 85 or more high, 70 elevated, 40 guarded. Wind: 35 mph now or a 48-hour gust of 50 mph is high; 25 mph or a 35 mph gust elevated. Smoke: Heavy overhead elevated, Medium guarded. Lightning: a strike within 5 mi elevated, within 25 mi guarded, with sampling caveats.

The report carries a BLUF card, a hero exposure map, five stat cards, a ring exposure table, hotspot and named-fire tables, alert, outlook, fuel, wind, smoke and lightning sections each with its own map, 24/48/72-hour rainfall chips with a regional map, a 10-day forecast strip, an eleven-entry sources list and a "Not yet factored" list naming relative humidity, fuel moisture and terrain slope as unimplemented. Seven map figures are rendered off-DOM as 2x canvases on Esri dark-grey tiles (MODIS Aqua true colour under the smoke map) with LANDFIRE and QPF overlays; a figure that fails to load is omitted. Output is browser print only, via "Print / Save as PDF" and `window.print()`; there is no server-rendered PDF, persisted report or share link. Thresholds are mirrored by hand in `docs/RISK-REPORT-MATRIX.md`. <span class="tag">partial</span>

## Coverage and freshness at a glance

| Domain | Source(s) | Cadence | Geographic coverage | Maturity |
|---|---|---|---|---|
| NWS alerts | api.weather.gov direct; `/api/alerts/active` fallback (60 s cache) | 60 s | US; county polygons for SAME-coded alerts only | production |
| Radar / IR satellite | RainViewer manifest via `/api/radar` (2 min cache); tiles direct | 2 min; 10-min frames; 30–120 min window plus nowcast | Global mosaic | production; Combined partial |
| Precipitation forecast | NOAA WPC QPF MapServer, live tiles | Live; issued 06Z and 18Z | CONUS | production |
| Wind field | Open-Meteo GFS via `/api/wind`; Postgres snapshot; baked fallback; MET Norway probe fallback | 30 min; stale after 45 min | Global 5° grid, ±80° | production |
| FIRMS hotspots | Esri Living Atlas VIIRS, browser-direct | 5 min plus camera stop; 24 h window | Global; top 2,500 in view or 5–200 mi of pins | production |
| Named fires | NIFC/WFIGS ArcGIS, browser-direct | 5 min | US; incidents ≥ 5 ac, perimeters ≥ 100 ac | production |
| 7-day fire potential | NWCG PSAs via `/api/fire-outlook` (2 h cache) | 30 min | CONUS, ~234 PSAs | production |
| Smoke | NOAA HMS KML via `/api/smoke` (2 h cache) | 2 h; product up to 2 days old | North America | production |
| Fuel models | USGS LANDFIRE LF2024 FBFM40, browser-direct | On demand | CONUS, 30 m | production |
| Air quality | AirNow + PurpleAir via `/api/aqi` (15 min cache) | 15 min | CONUS box; ≤ 6,000 PurpleAir sensors | production; keys required |
| Earthquakes | USGS feeds via `/api/earthquakes` (60 s cache) | 5 min (day feed) | Global | production; period filter partial |
| Tropical | NHC and GTWO ArcGIS, browser-direct; JTWC via `/api/jtwc-invests` (1 h cache) | 5 min | NHC/CPHC basins; JTWC W Pacific, Indian Ocean, S Hemisphere | production; no server cache |
| Lightning | Blitzortung relays in-browser; server collector with Postgres 24 h history | Live; history 30 s, 1–24 h windows | Global; 1-in-6 sample | production |
| River gauges | NOAA NWPS via `/api/rivers` (15 min background); detail 10 min cache | 15 min | US, ~12.7k gauges | production |
| Power outages | 18 sources: 5 ArcGIS, 9 KUBRA, 4 NISC via `/api/outages` | 4 min server; 5 min client | 14 state labels (~19 served); points only | partial |
| Aircraft | adsb.fi by registration; adsbdb and Planespotters; Postgres snapshot | 10 s company / 60 s specials | Global; 10 hard-coded tails | production |
| Ships | AISStream; CruiseMapper scrape or VesselFinder / MyShipTracking (paid) | Stream plus 120 min poll; 30 s client | Global; 7 Windstar vessels | partial (scrape-dependent) |
| Satellites | CelesTrak via `/api/satellites` (2 h cache); SGP4 in browser | Once per toggle; 250–1,500 ms tick | Global; 5 groups, ≤ 2,500 objects | production |
| Breaking News | 5 RSS feeds plus custom via `/api/news` (5 min cache); NPS park news | 5 min / 10 min | Global headlines; gazetteer geolocation only | production |
| GDELT news map | GDELT GKG v1 via `/api/news-map` (10 min cache) | 10 min; 6 h window | Global | partial (share-page pins) |
| Intel Feed | 7 built-in sources plus watchlist (≤ 100) via `/api/intel` | 90 s; 800 items / 36 h buffer | Source-dependent; ephemeral | production; pins partial |
| Property Watch | FIRMS + NWS + USGS proximity scan | 5 min; ≤ 1 scan / 60 s | 31 locations at 25/50/100 mi | production |
| Status Dashboard and score | All of the above plus Open-Meteo, NHC, JTWC, AIS | 300 s while open | 13 groups plus 7 ships | production |
| Duty-officer briefing | Anthropic API via `/api/briefing`, or rules digest | 9 min throttle; 10 min cache | As dashboard | production; AI path paid |
| Wildfire Risk Report | 11 feeds at 1/5/25/100 mi | Once per open | Any property; fuels CONUS, smoke North America | partial (wildfire only, print output) |


# Crisis Response


## Overview

The crisis workspace is the platform's incident-management mode. The red CRISIS button in the top bar opens a full-screen overlay that replaces the globe with an incident dashboard and, for any open incident, a tabbed workspace with a live-map dock. When any incident is Active the button pulses with a count badge and the browser tab title becomes `⚠ CRISIS (N) · GSOC Monitor`, so a backgrounded tab still reads as a status indicator.

Three audiences use it: **operators** (any signed-in member — incidents are team-wide with no ownership, and any member can create, edit, share and delete a live incident), **administrators** (the only role that can delete an archived incident or manage the Incident Action Plan library) and **stakeholders**, who open a password-protected share link on a phone with no account.

### Lifecycle

An incident carries one of four statuses in lifecycle order: **Monitoring** (sky, list rank 1) → **Active** (red, rank 0 — sorts first, pulses, counts toward the CRISIS badge) → **Recovery** (amber, rank 2) → **Closed** (green, rank 3). A new incident starts Active. The operator sets any status from a chip row; ordering is not enforced, and every change writes a `status-change` audit entry with `{from, to}`. Retired statuses `contained` and `resolved` map forward to Recovery and Closed; an unknown status falls back to Active rather than quietly filing an incident as closed.

**Stand Down** concludes an incident through three steps, each shown with ✓/✗ status in a modal that previews the plan and takes an optional reason:

1. Publish the final Closed snapshot to every active share link and wait, so viewers see the conclusion rather than a stale ACTIVE page (a snapshot update after revocation is rejected, so this comes first).
2. Revoke every active share link. Failures are non-blocking and reported inline; an unrevoked link keeps serving the closed snapshot.
3. Archive: stamp `archivedAt`, force Closed, record who and why, end every open ICS assignment, and write a `stood-down` entry with the reason and the number of released assignments.

An archived incident is a frozen record: every content mutation is a no-op and the UI disables editing everywhere except log viewing, share-link revocation (a leaked link) and after-action content. **Reopen** clears the archive stamps, sets Monitoring — the operator escalates — writes a `reopened` entry and republishes to any surviving link; the stand-down history stays in the log. The dashboard lists live incidents sorted by status rank then newest-first, with a collapsible Archive offering View, Reopen, PDF Report and admin-only Delete.

## The incident record

Every incident is one self-contained JSON document, minted client-side with a `c-` + UUID id so multiple tabs never collide, and stored as a JSONB row in Postgres. The server validates only id, type and status on write; the rest is opaque, bounded by a 5 MB body limit.

| Group | Fields |
|---|---|
| Situation report | Name; start and end (datetime-local, no timezone); location; type; status; executive summary; ICS complexity type (Type 5 → Type 1, stored and audited but its selector is removed from the UI) |
| Location, property, vessels | `locationGroupId` — the primary property group or the pseudo-group `windstar-ships`; `extraLocationGroups` — extra property-pin groups for the share map; `shipMmsis` — fleet vessels by MMSI only (positions are always read live) |
| Org chart | `roles[]` — ICS nodes with title, abbreviation, parent, colour, command-staff and support flags, and a `builtin` lock on the 21 NIMS defaults; `personnel[]` — per-incident pool (name, title, phone, email); `assignments[]` — who held which role, with `startedAt`/`endedAt` |
| Log | `actionLog[]` — newest-first entries: timestamp, description, `action`/`event`/`info` type, actor, optional image attachment (Cloudinary URL), and for system entries a `system` kind plus `meta` map |
| Checklists | Sparse map of item id → `{checked, at, by}`, server-stamped |
| Intake | Sparse map of question id → answer text |
| Draw layers | `drawLayers[]` — name, category type, geometry (polygon / line / point), directional flag, colour, visibility, vertices, optional thumbnail; `liveLayers[]` — live feeds prescribed for the share map |
| Share links | `shareLinks[]` — every link ever created (token, URL, label, password, active, expiry); a legacy single `shareToken` |
| Closure and AAR | `archivedAt`, `closedBy`, `standDownReason`; `aar` — four review answers and corrective actions |

A fresh incident starts Active with the 21 default roles, empty lists and one system entry, "Incident created". Older rows lacking newer keys are treated as empty and normalised on read, never rewritten until a person edits them.

### Taxonomy

The taxonomy lives in `client/src/crisis/taxonomy.ts`, mirrored on the server for write validation. There are 26 canonical types in 7 categories; two retired ids (`chemical` → HazMat, `security` → Violence / Threat) are accepted on write and aliased forward on read, and unknown ids fall back to Other. Each type carries a label, hex colour, emoji icon, sort order and an advisory default severity — advisory because the record has no severity field.

| Category | Types (default severity) |
|---|---|
| Natural Hazards | Wildfire (high), Hurricane / Tropical (high), Severe Weather (moderate), Winter Storm (moderate), Flood (high), Earthquake (high), Wildlife (low) |
| Fire & HazMat | Fire (Structure) (high), HazMat (high) |
| Infrastructure & Utilities | Utility / Power Outage (moderate), Water System (moderate), IT / Comms Outage (moderate), Cyber Incident (high) |
| Security | Violence / Threat (critical), Suspicious Activity (low), Theft / Loss Prevention (low), Civil Unrest (moderate) |
| Medical & Life Safety | Medical (moderate), Mass Casualty (critical), Fatality (critical), Search & Rescue (high), Public Health (moderate) |
| Access & Operations | Road Closure / Access (low), Maritime (moderate), Aviation (moderate) |
| Other | Other (low) |

## The crisis workspace tabs

An open incident shows a header (status, name, save indicator, Share Links, Stand Down or PDF Report + Reopen, Delete), a tab strip, and on desktop a resizable dock (360 px to min(720 px, 50 vw)) whose upper 46% is a transparent window through which the real Cesium globe stays interactive, with the Map Layers toolkit beneath. The dock is hidden on mobile.

### Situation Report

The default tab. Row one holds an eight-row Executive Summary and an Incident Information card: name, start and end, location, Property (None, any property group, or "Fleet (live positions)"), Type grouped by category, and the status chips. Below sit the ICS org chart, the Actions & Events log and **Live Data Layers**, where the operator prescribes which live feeds appear on the share map (the 18-layer whitelist is under Stakeholder sharing), adds Property Pin groups, and attaches fleet vessels. The **Windstar Vessels** picker shows one card per hull with live AIS status ("Underway 13.4 kt · 2m ago", "no position reported"), polled every 2 minutes, plus "All N" / "Clear". Changes are logged as a `vessels-change` entry naming what was added and removed.

### Action log

`+ Action`, `+ Event` and `+ Info` prepend a row stamped with the current time and the signed-in user and focus its description so an immediate Ctrl+V lands in it. Each row has a type badge that cycles action → event → info, timestamp and actor, description, attachment and delete. Images attach by picker or paste, resized in the browser to at most 1200 px (JPEG 0.82), uploaded unsigned to Cloudinary and stored as a URL; thumbnails open a zoomable lightbox. Header controls hide or show Info and System entries (system starts hidden) and switch between a paginated table (10 newest; Show 25 / 50 / 100 / all) and a **timeline** snake whose horizontal gaps encode elapsed time on a log scale saturating at one day.

The store also writes an audit entry for every state change, with `entryType: event`, the signed-in user as actor, a `system` kind and a `meta` payload. They display with a "system" badge, are immutable on the server (`PATCH` returns 403), and are excluded from operator counts. Twelve kinds exist:

| Kind | Written when | Meta |
|---|---|---|
| `created` | Incident created | — |
| `status-change` | Status changed | from, to |
| `complexity-change` | ICS complexity changed (selector hidden) | from, to |
| `assignment` | Person assigned, including command transfer | roleId, roleTitle, name, replaced |
| `assignment-ended` | Assignment ended | roleId, roleTitle, name |
| `role-added` | ICS role added | roleTitle |
| `role-removed` | Role removed (cascades to sub-roles) | roleTitle, subRoles |
| `share-created` | Share link published | token, label |
| `share-revoked` | Share link revoked | token |
| `stood-down` | Stand-down completed | reason, releasedAssignments |
| `reopened` | Incident reopened | — |
| `vessels-change` | Vessels attached or removed | added, removed, count |

System entries can still be deleted by any operator while the incident is live, so the trail is tamper-evident rather than tamper-proof.

### ICS org chart

The chart seeds 21 built-in NIMS roles: Incident Commander at the root; Command Staff on dashed advisory connectors — Safety Officer, Public Information Officer (with a multi-person "GSOC Support" sub-role) and Liaison Officer; and four General Staff sections — Operations (Branch Director, Division/Group Supervisor), Planning (Resources, Situation, Documentation, Demobilization Unit Leaders), Logistics (Support and Service Branch Directors) and Finance/Admin (Time, Procurement, Compensation/Claims, Cost Unit Leaders). Built-in titles are locked; custom roles take a title, abbreviation, colour, advisory flag and support flag (multiple concurrent holders). Roles can be removed only when unstaffed (cascading to sub-roles and silently dropping their assignments), restored from a "Restore removed roles" list, or reset to defaults.

A **personnel pool** under the chart captures name, title, phone and email and renders draggable chips; dropping one on a role assigns that person. One person cannot hold two roles at once; assigning to a non-support role ends the previous holder — a command transfer logged as "<name> assigned as <role> (replacing <previous>)"; support roles accumulate holders. The edit panel lists current holders and a scrollable **assignment history** with start → end stamps, the staffing record the after-action report reads. Contact details never reach a share link. The pool is per-incident, not a shared directory.

### Checklists

A role picker (IC, SO, PIO, LNO, OSC, PSC, LSC, FSC) selects a role card with "Reports to" / "Directs", a progress bar and three phases: **Immediate** (first minutes, highlighted red), **Ongoing** (operational period) and **Stabilization / Demobilization**. Every touched item shows "✓ Checked <time> · <who>" or "↺ Unchecked <time> · <who>" from server-stamped state.

One template exists in code: `vessel-grounding-v1`, "ICS Role Checklists", from the Vessel Grounding / Run Aground scenario, with 90 items across 8 roles — Incident Commander 15, Safety 11, PIO 11, Liaison 10, Operations 13, Planning 10, Logistics 10, Finance 10. Item ids are stable (`<role>-<imm|ong|dem>-<n>`) so wording can change without touching stored state. The per-type template hook is empty, so every type — a wildfire or a cyber incident included — receives the vessel-grounding checklist <span class="tag">partial</span>.

### Intake

A first-notification questionnaire of 30 questions in six groups, also from the vessel-grounding template: A. Vessel Identification & Position (6), B. Life Safety & Casualties (5), C. Vessel Status & Stability (6), D. Environmental (4), E. Passengers & Guests (4), F. Command, Communications & Resources (5). The header counts "N/30 answered"; answers ride the incident record and build an intake table on the share link. The per-type hook is likewise empty <span class="tag">partial</span>.

### Map layers and drawing tools

`+ New Layer` takes a name, a category type — Fire Perimeter, Burned Area, Flood Zone, Staging Area, Exclusion Zone, Search Grid, Other, each with a default colour — and a shape: Area (polygon, 3+ vertices), Line (2+), Arrow (a directional line toward the last vertex) or Point. Draw hands the full-screen globe to a drawing controller with Undo / Finish / Cancel; on finish a thumbnail of up to 640×360 px (JPEG 0.75) is captured from the Cesium canvas and uploaded to Cloudinary, and the overlay reopens.

Each layer row shows a measurement computed from its vertices — area, perimeter and vertex count for polygons; length in km/mi and nautical miles, with bearing for a two-point run, for lines; lat/lon for points — plus Flip (reverse an arrow), visibility, Coords and delete. **Coords** imports pasted decimal degrees, degrees with N/S/E/W letters, DMS, or WKT (lon-lat auto-detected); a MULTIPOLYGON collapses into one layer. Drawn layers of every live incident render on the operator globe with a click-to-identify popup, and the same measurements appear on the share page and in the printed report.

### Vessels, share links and placeholders

Vessel attachment lives in the Situation Report; the header's **Share Links** panel is detailed below. Two further tabs, **Resource Tracker** and **Comms Log**, render disabled with a "Coming soon" tooltip and have no store fields, components or endpoints behind them.

## Multi-operator collaboration

Incidents are a shared workspace: every operator loads the same list once at sign-in and thereafter receives every peer's change within about a second. Three channels carry writes, each matched to how contentious the data is.

| Channel | Data | Mechanism | Conflict behaviour |
|---|---|---|---|
| Incident blob | Summary, incident info, intake, org chart, personnel, draw layers, live-layer prescriptions, AAR | New ids `POST /api/incidents` immediately (server upserts, so retries are safe); known ids `PUT /api/incidents/:id` debounced 1.5 s per incident. Log and checklists are omitted; the server preserves its own copies. | Last-write-wins. Two operators editing blob fields inside the window can overwrite each other; SSE narrows it to roughly 1 s. |
| Action log | Each entry | `POST /api/incidents/:id/log` immediately (idempotent by id); `PATCH …/log/:entryId` after an 800 ms debounce not re-armed by further typing; `DELETE …/log/:entryId`. All under `SELECT … FOR UPDATE`. | Conflict-safe per entry. A PATCH that 404s means a peer deleted the entry — delete wins. |
| Checklist toggles | Each item | Optimistic flip, then `POST /api/incidents/:id/checklist/:itemId`; the server applies it under a row lock, stamps its own time and actor, and returns the authoritative map. | Conflict-safe per item; 500-item cap; 409 on archived incidents. |

Every editor holds an EventSource on `/api/incidents/events` (auth cookie, ping every 25 s, browser auto-reconnect). The server broadcasts `upsert` and `delete` on every mutation from any route, including share-link viewers' checklist toggles. On receipt: if a local blob write is pending for that incident the event is dropped (the local write wins and its echo re-converges the client); otherwise the server's log and checklist map win except for entries and items still in flight locally; and if nothing differs the event is treated as the client's own echo, so a peer's change is never re-emitted. The stream has no event ids or replay, and fan-out is in-process memory, which assumes a single server process.

The save indicator reads "Saving…", "All changes saved" (only when the blob, log and checklist engines are all idle) or "Unsaved — will retry". When the tab is hidden or closing, pending blob writes are flushed with `navigator.sendBeacon` to `POST /api/incidents` (the upsert path stands in for the PUT and carries the auth cookie) and pending log edits with keepalive fetches. Unit tests cover sync canonicalisation, log and checklist merges, the taxonomy and both templates; there are no route-level tests of the row locks or SSE fan-out.

## Stakeholder sharing

A share link publishes a password-protected, read-mostly projection of one incident to people with no account. Any member can create one from the Share Links panel with an optional audience label of up to 80 characters.

**Generation.** `POST /api/crisis/publish` mints a UUID token and a 10-character password from a 32-symbol alphabet with no O/0/I/1, stores `sha256(sha256(password))`, sets expiry to now + 72 hours, and returns the token, URL (`/?share=<token>`), password — once — and expiry. The panel lists links newest-first with label, Active / Revoked, "expires in 51h" (amber under 12 h), Renew (a fresh 72 h, not cumulative), Copy, the password chip, Revoke, and "Opened N× by ~M viewers · last <time>" from the access log, viewers being distinct IPs. A 413 is surfaced as "too large to share". Creation and revocation write `share-created` / `share-revoked` entries; share actions bypass the archive freeze so a leaked link can always be revoked, and deleting an incident revokes all its links. Links have no ownership: any member can renew, revoke or read statistics for any token.

**What is published.** The projection strips personnel contact details (assignments reduce to id, role, name, start, end), sends vessel MMSIs only, excludes the personnel pool, share links and AAR, and always sends concrete list values so removals propagate through the server's shallow merge. The open incident is re-published to every active link 1.5 s after any change, even with the overlay closed; stand-down and reopen publish explicitly. Publishing is best-effort — failures are logged, not retried.

**The viewer's phone.** A 401 shows a "Protected Situation Report" gate. The typed password is upper-cased, hashed in the browser with SHA-256 (HTTPS only) and sent as `?k=`, so the plaintext never travels in a URL. The page has three tabs:

- **Situation Report** — sticky header with a "last updated" readout that turns amber with "· may be stale" after 45 min; executive summary; an intake table when answers exist; a **Property Watch** card running the same FIRMS + NWS + USGS proximity scan as the operator widget (25-mile default radius, polled every 5 min) filtered to the prescribed property groups; **vessel cards** with live AIS status, position, destination and ETA polled every 2 min, showing "No position reported — not shown on the map" rather than an implied all-clear; Incident Details; the action log with the editor's filters, timeline and lightbox; the map; a Map Layers list; and a read-only ICS org chart.
- **IAP** — an in-page reader of the Incident Action Plan PDF for the incident type.
- **Checklists** — the editor's board, writable: viewers enter a name (default "Share viewer") and toggle items through `POST /api/crisis/share/:token/checklist/:itemId`, the only write a viewer can perform. The server stamps it, updates the parent incident under a row lock, broadcasts to operators and rewrites every live snapshot. Archived incidents return 409.

**Globe versus flat map.** When the incident prescribes live layers, property groups or vessels, the page mounts a Cesium globe (72 vh) reusing the operator's layer components, with drawn layers, property pins, sonar-style vessel markers, tap-to-inspect shape cards, a viewer measure tool, a Map Controls card (Dark / Light / Dark Sat / Topographic basemaps, Zoom to Incident, Reset), one toggle chip per prescribed layer and colour legends where needed. When only drawn layers exist the page renders a 420 px Leaflet map on Esri dark-grey raster tiles instead — no WebGL — with directional chevrons on arrows and popups carrying type, geometry, vertex count and measurement; pins and vessels are not drawn there. The Map Layers list shows each drawn layer with thumbnail, measurement and an "On map / Hidden / Hidden by team" state; viewers can hide layers but never surface one the team hid.

**Live updates and closure.** After unlocking, the page opens an EventSource on `/api/crisis/share/:token/events` (25 s keepalive; `connected` with the current snapshot, then `update` on every publish or checklist change). A `revoked` event closes the stream and refetches, landing on the **closure page**: "Situation Report — Concluded", the incident name and final status, "Stood down" or "Report closed" with the timestamp, the final executive summary, and guidance to contact the GSOC for a new link. Expired links show the same page with an expiry reason. Every successful snapshot read appends token, IP and user agent to an access log that is never pruned.

**The 18 shareable live layers.** Only feeds served by public, keyless read paths are whitelisted; company asset layers (flights, ships, satellites, locations), metered Cesium ion layers and cosmetic layers are excluded. Ids unknown to the running build are dropped, because snapshots outlive deploys.

| Group | Layers (provider) |
|---|---|
| Weather | Precipitation Radar (RainViewer), Precip Forecast (NOAA WPC QPF), Hurricanes (NHC + JTWC), Lightning (Blitzortung), Wind Particles (GFS), Wind Streamlines (GFS) |
| Fire & Smoke | Hotspots (NASA FIRMS VIIRS 24 h), Named Fires (NIFC), Smoke (NOAA HMS), Air Quality (AirNow + PurpleAir), 7-Day Fire Potential (NWCG), Fuel Models (LANDFIRE FBFM40) |
| Hazards & Alerts | NWS Alerts, Earthquakes (USGS M2.5+), Rivers & Floods (NOAA gauges), Power Outages (multi-state utility feeds) |
| Open-Source Intel | News (GDELT), Intel Feed (scanner / crime / social) |

## Incident Action Plan library

Each incident type can carry one Incident Action Plan PDF, plus one general default used when a type has none. Documents are stored as BYTEA in Postgres (the dyno filesystem is wiped on deploy and the Cloudinary preset is image-only), one per type enforced by a unique index. On first boot the migration seeds the default, "Incident Action Plan — Generic Template", a 14-page ICS/NIMS fill-in-forms PDF whose metadata title reads "(Demonstration)"; a one-shot flag stops a deleted or replaced seed from resurrecting.

Administrators manage the library from the Admin panel's IAP Library; any signed-in user can list and preview, but upload and delete require the admin role. Uploads arrive as base64 JSON (25 MB body limit), are capped at 15 MB, must begin with the `%PDF-` magic bytes, and replace the existing document for that type. There is no version history and no per-incident IAP.

Share viewers read the document through `GET /api/crisis/share/:token/iap`, which resolves the snapshot's normalised type to its document or the default (404 `{noIap: true}` otherwise) and streams it inline with a 5-minute private cache. The IAP tab renders every page to canvas with pdf.js, with zoom from 0.6× to 3× and an "Open ↗" link.

## After-action reporting

The after-action report opens from the **PDF Report** button on an archived incident — only after stand-down; open incidents have no export path. It is a full-screen modal reading the live record, in this order: report header; a repeating print page header; Executive Summary and Incident Details (location, property or "Windstar Ships", vessels, start, end, type, created, archived, stood down by, reason); Response Metrics; the ICS org chart fully expanded with the last holder of each seat marked "· released"; the ICS Progression swimlane; the Assignment Roster; the After-Action Review; Corrective Actions; the complete log with actors and inline images; an Incident Map of all drawn layers; the Map Layers list with thumbnails and measurements; and a timestamp footer.

**Response Metrics** — five cards computed purely from the captured record, covered by 17 unit tests:

| Metric | Computation |
|---|---|
| Duration | (archivedAt, or now) − (incident start, or creation); "start → stand-down" or "start → now (still open)" |
| Time to Active | Creation → first `status-change` with `to: active` during the first activation run (before the first `stood-down`); "At creation" when created Active; "Never active" otherwise |
| Personnel | Unique people by pool id (fallback: normalised name), with "<n> assignments · <k> command transfers", a transfer being a consecutive different holder of any root role |
| Log entries | Total, with "<operator> operator · <system> system" |
| Stakeholder reach | Access-log opens summed across every link the incident ever had, as "<count>×" with "~<distinct IPs> viewers · <links> links"; "—" with no links |

A footnote reports "ICS complexity at close: Type n" when set; spans are humanised as "18m", "5h 12m", "3d 4h".

**ICS staffing swimlane** — one row per role ever staffed, in chart order, with a bar per assignment clamped to the window from the earliest start or creation to stand-down (or now); open assignments are dashed. It renders as a 940-wide SVG with hourly to weekly ticks anchored to local midnight, tooltips "<name> — <start> → <end | still assigned>", and the legend "adjacent bars in one row = seat transfer". The **Assignment Roster** lists every assignment chronologically: name, role, assigned, released (or "active"), held for.

**Four-question review** — autosaving fields for "What was expected to happen?", "What actually happened?", "What went well, and why?" and "What can be improved, and how?", stored on the incident, exempt from the archive freeze and never included in share snapshots. The **corrective-action tracker** adds rows with a done checkbox, text, owner and due date, with an "(n open)" counter.

**Output path.** "Print / Save as PDF" calls the browser's print dialog with an injected stylesheet: letter portrait, 0.6 in margins, dark theme flipped to paper-white, page-break protection on cards and headings, and a repeating page header. There is no server-side render, so output depends on the viewer's browser, and no structured (CSV / JSON) export of AAR or checklist data exists <span class="tag">partial</span>.

## Maturity at a glance

| Capability | Status | Note |
|---|---|---|
| Crisis overlay, CRISIS button, tab-title badge | production | Badge counts Active, non-archived incidents |
| Incident dashboard and archive | production | Any member deletes live incidents; admins only for archived |
| Lifecycle statuses and audit entries | production | Transitions unenforced |
| Stand Down / Reopen sequences | production | Revocation failures non-blocking, reported inline |
| Incident record and taxonomy (26 types, 7 categories) | production | Severity advisory only |
| ICS complexity type | partial | Stored and audited; selector hidden |
| Situation Report | production | Start/end stored without timezone |
| Action log, attachments, timeline | production | Hardcoded Cloudinary account, unsigned preset; system entries deletable while live |
| ICS org chart, personnel pool, assignment history | production | Pool per-incident; role removal drops sub-role assignments silently |
| Checklist board and per-item sync | production | Server-stamped; 500-item cap |
| Checklist and intake templates | partial | One vessel-grounding template each (90 items, 30 questions) for all types |
| Map layers, drawing, coordinate import, measurements | production | MULTIPOLYGON imports collapse to one layer |
| Fleet vessel attachment | production | Positions depend on server AIS configuration |
| Live Data Layers prescription | production | 18 keyless layers |
| Blob sync (last-write-wins, 1.5 s) | production | ~1 s concurrent-edit overwrite window |
| Action-log and checklist sync (row-locked) | production | Conflict-safe per entry and per item |
| SSE fan-out (editors and viewers) | production | In-process; single-server assumption; no replay |
| Share links (password, 72 h TTL, renew, revoke, access log) | production | No link ownership; key in query string; no rate limiting on public routes |
| Share page (three tabs, live map, closure page) | production | Flat map omits pins and vessels; updates best-effort |
| Viewer-editable checklists | production | Pre-checklist links read-only (409) |
| IAP library | production | One PDF per type plus default; 15 MB cap; no versions |
| After-action metrics, swimlane, roster | production | Reach counts distinct IPs — approximate |
| AAR four questions and corrective actions | production | Exported only via the printed report |
| Print / Save as PDF | partial | Browser print only; no server-side render |
| Resource Tracker, Comms Log tabs | placeholder | Disabled "Coming soon" tabs; no data model |
| Operational periods / resource tracking model | placeholder | Not modelled; periods appear only as checklist phase labels and assignment stamps |


# Data Sources

GSOC Monitor draws on roughly ninety distinct upstream feeds from about forty providers. Almost all of them are free public services; the exceptions are called out below. This chapter is the authoritative register of where every piece of data on the globe comes from, how it is reached, what it costs, and how fresh it is. "Path" says whether the operator's browser talks to the provider directly or the server proxies it; "Cadence" gives the effective refresh interval and any server cache.

## Cost and key summary

| Category | Sources | Notes |
|---|---|---|
| Free, no key | the large majority — NOAA/NWS, USGS, NASA, NIFC, NWCG, EPA AirNow data (key is free), CelesTrak, adsb.fi, Blitzortung, GDELT, Esri Living Atlas, Open-Meteo, MET Norway, OSM/Nominatim, RSS publishers, PulsePoint, CHP, Socrata, Bluesky, KUBRA/NISC utility maps | several require an identifying User-Agent by policy |
| Free, key required | AirNow, PurpleAir, aisstream.io, NPS Data API, Cesium ion | keys are free registrations; the AQI layer and ship AIS stream are empty without them |
| Freemium | Cloudinary image hosting | unsigned upload preset on the owner's free tier |
| Paid, optional | VesselFinder or MyShipTracking (vessel positions by IMO), Anthropic Claude (AI briefing), Google Map Tiles 3D | each is off unless its key is set |
| Paid, infrastructure | Heroku dyno (~$5–7/month basic), Heroku Postgres add-on | the only unavoidable spend |

## Severe weather and environment

| Source | Provider | Path | Auth | Cadence | Used by |
|---|---|---|---|---|---|
| Active alerts (`api.weather.gov/alerts/active`) | NOAA National Weather Service | browser-direct, server fallback | User-Agent policy | 60 s poll; server cache 60 s stale-on-error | Alerts layer, Property Watch, dashboard, risk report, screensaver |
| County polygons by FIPS | US Census via plotly/datasets on GitHub | browser-direct | none | loaded once per session | resolves county-coded alerts to polygons |
| Radar and IR satellite tiles | RainViewer | manifest via server, tiles browser-direct | none | manifest 2 min; tiles browser-cached | Precipitation Radar layer |
| QPF precipitation forecast (24/48/72 h) | NOAA Weather Prediction Center MapServer | browser-direct | none | per risk report; layer rasters on toggle | Precip Forecast layer, risk report |
| Global wind grid (5°, 2,376 points) | Open-Meteo (NOAA GFS) | server | none | 30 min background refresh → Postgres snapshot → baked fallback | Wind particles, streamlines, arrows |
| Point wind forecast (7-day hourly) | Open-Meteo, MET Norway fallback | server | none / User-Agent | 30 min cache; 10-min circuit breaker to met.no | Wind probe panel, risk report |
| 10-day daily forecast | Open-Meteo | server | none | 30 min cache | Risk report forecast strip |
| Dashboard weather (current temp/wind, 7-day precip) | Open-Meteo | browser-direct | none | one batched call per 5-min dashboard scan | Property Status Dashboard |
| Daily MODIS true-colour imagery | NASA GIBS (Terra and Aqua) | browser-direct | none | immutable per date | Earth basemap, risk report smoke map |

## Wildfire, smoke and air quality

| Source | Provider | Path | Auth | Cadence | Used by |
|---|---|---|---|---|---|
| VIIRS thermal hotspots (24 h, FRP) | NASA FIRMS via Esri Living Atlas | browser-direct | none | 5 min plus camera moves; 2,500 cap | Fires layer, Property Watch, dashboard, risk report |
| Current wildfire incidents (≥5 acres, <100 % contained) | NIFC WFIGS / IRWIN | browser-direct | none | 5 min; 800 cap | Named Fires layer, risk report |
| Current fire perimeters (≥100 acres) | NIFC WFIGS | browser-direct | none | 5 min; 500 cap | Named Fires layer |
| 7-day significant fire potential (PSA polygons) | NWCG Predictive Services | server | none | 2 h cache; client 30 min | Fire Outlook layer, risk report |
| Smoke plumes (daily KML) | NOAA NESDIS Hazard Mapping System | server | none | 2 h cache; tries today then two days back | Smoke layer, risk report |
| Reference monitors (PM2.5, O3, PM10, CO, NO2, SO2) | US EPA AirNow | server | `AIRNOW_API_KEY` (free) | 15 min shared cache | AQI layer, dashboard |
| Community PM2.5 sensors | PurpleAir | server | `PURPLEAIR_API_KEY` (free read key) | 15 min shared cache; EPA correction applied; 6,000-sensor cap | AQI layer |
| Fuel model raster (LF2024 FBFM40, 30 m) | USGS/USFS LANDFIRE ImageServer | browser-direct | none | per zone / per report; CONUS only | Fuel layer, Fuel Analyzer, risk report |

## Seismic, tropical, lightning and flood

| Source | Provider | Path | Auth | Cadence | Used by |
|---|---|---|---|---|---|
| Earthquake summary feeds (hour/day/week × magnitude) | USGS Earthquake Hazards Program | server | none | 60 s cache; client 1–15 min by period | Earthquakes layer, Property Watch, dashboard |
| Active hurricanes (positions, tracks, cones) | NOAA NHC via Esri Living Atlas | browser-direct | none | 5 min, five sublayer queries | Hurricanes layer, dashboard, share globe |
| Tropical weather outlook (2/7-day development regions) | NOAA NWS tropical MapServer | browser-direct | none | 5 min | Hurricanes layer |
| Invest advisories (West Pacific, Indian Ocean, South Pacific) | US Navy Joint Typhoon Warning Center | server | none | 1 h cache, text bulletins parsed | Hurricanes layer, dashboard |
| Live lightning strikes | Blitzortung.org community relays (unofficial WebSocket) | browser-direct and server | none | streaming; 10-min / 2,500-strike window per viewer | Lightning layer, ticker |
| Lightning history (1–24 h) | Blitzortung via server collector | server | none | 1-in-6 decimated ring buffer, Postgres chunks every 5 min; client 30 s | Lightning History layer, risk report |
| River gauges (~12.7k) and gauge detail | NOAA National Water Prediction Service | server | User-Agent policy | 15 min background refresh; detail 10 min cache | Rivers & Floods layer |

## Infrastructure, aviation, maritime and space

| Source | Provider | Path | Auth | Cadence | Used by |
|---|---|---|---|---|---|
| Statewide and utility outage feeds (5 ArcGIS services) | Cal OES, Salt River Project, SSVEC, Minnesota Power, Riverside PU | server | none | 4-min aggregate rebuild | Outages layer |
| Storm Center outage maps (9 utilities: Oncor, Georgia Power, JEA, Colorado Springs, Cobb EMC, LG&E/KU, Evergy, Versant, Appalachian Power) | KUBRA | server | none | 4 min; quadkey tile walk capped at 150 tiles / 25 s | Outages layer |
| Co-op outage maps (Sawnee, SLEMCO, Price Electric, Cloverland) | NISC | server | none | 4 min | Outages layer |
| ADS-B positions for ten tracked registrations | adsb.fi open data | server | User-Agent; ~1 req/s guidance honoured | 10 s active / 60 s idle; Postgres snapshot | Flights layer |
| Airframe registry (make, model, operator) | adsbdb.com | server | none | 7-day refresh | Flight detail panel |
| Aircraft photos | Planespotters.net | server (thumbnails hotlinked) | none, attribution shown | 7-day refresh | Flight detail panel |
| Live AIS (fleet MMSIs) | aisstream.io | server WebSocket | `AISSTREAM_API_KEY` (free) | streaming; community receivers only | Ships layer |
| Fleet last-known positions | CruiseMapper (HTML scrape) | server | none; disable with env | every 120 min | Ships layer (default position source) |
| Fleet positions by IMO | VesselFinder or MyShipTracking | server | paid key | every 120 min | Ships layer (when configured) |
| Reverse geocoding for snapshots and cards | BigDataCloud | browser-direct | none | per click | Fleet snapshot, screensaver cards |
| Coastlines and major cities | Natural Earth, GeoNames (bundled) | bundled | none | static | Fleet snapshot map |
| Two-line element sets (stations, brightest, GPS, weather, Starlink) | CelesTrak | server | none | 2 h cache per group; propagation client-side | Satellites layer, ISS tour |

## News and open-source intelligence

| Source | Provider | Path | Auth | Cadence | Used by |
|---|---|---|---|---|---|
| World news RSS (BBC, Guardian, Sky, NPR, Al Jazeera) | publishers | server | none | 5 min cache, 120-story cap | Breaking News widget, ticker |
| User-added RSS feeds | any publisher | server | none | 5 min per feed | Breaking News (per-browser) |
| Park alerts and news releases (six parks) | US National Park Service Data API | server | `NPS_API_KEY` (free; `DEMO_KEY` default) | 10 min | News ticker Park mode |
| Geolocated security news events | GDELT GKG GeoJSON v1 | server | none | 10 min cache per query | News map layer (share pages), dashboard |
| Google News RSS search | Google News | server ingest | none | 90 s | Intel Feed |
| Bluesky author feeds and keyword search | Bluesky (AT Protocol) | server ingest | none | 90 s | Intel Feed |
| Fire/EMS dispatch incidents | PulsePoint (undocumented web-app endpoint) | server ingest | none | 90 s | Intel Feed |
| Statewide highway dispatch log | California Highway Patrol | server ingest | none | 90 s | Intel Feed |
| Open-data crime datasets (built-in: Chicago) | Socrata portals | server ingest | none | 90 s | Intel Feed |
| Generic RSS/Atom watchlist sources | any public publisher | server ingest | none; SSRF-validated | 90 s | Intel Feed |
| Place geocoding for intel items | OpenStreetMap Nominatim | server | User-Agent policy | 30-day cache; 16 lookups per cycle | Intel Feed, watchlist pins |
| Place search | OpenStreetMap Nominatim | server | User-Agent policy | 24 h cache per query | Search bar |
| County and park boundaries | Esri Living Atlas, NPS Land Resources Division | server | none | 24 h cache | National Parks screensaver |
| Nearby hospitals, hotels, police, fire stations; driving routes | Overpass API, OSRM demo router | browser-direct | none | on demand | Location detail panel |

## Basemaps, platform and AI

| Source | Provider | Path | Auth | Cadence | Used by |
|---|---|---|---|---|---|
| Gray canvas, imagery and label tiles | Esri ArcGIS Online | browser-direct | none | browser cache | Dark, Light, Dark Sat and Earth basemaps |
| Topographic tiles | OpenTopoMap | browser-direct | none | browser cache | Topographic basemap |
| World Terrain and OSM Buildings | Cesium ion | browser-direct | `VITE_CESIUM_ION_TOKEN` (free tier; demo token fallback) | tileset cache 192 MB | 3D Buildings & Terrain |
| Photorealistic 3D Tiles | Google Map Tiles API | browser-direct | `VITE_GOOGLE_MAPS_KEY` (paid, metered) | — | hidden layer |
| OpenStreetMap raster tiles | OSM Foundation | browser-direct | none | browser cache | screensaver minimaps |
| Image hosting for incident photos and map thumbnails | Cloudinary (unsigned preset) | browser-direct | none | — | Crisis action log, drawn layers |
| AI duty-officer briefing | Anthropic Messages API (Claude) | server | `ANTHROPIC_API_KEY` (paid) | 10-min cache by payload hash; rules digest fallback | Property Status Dashboard |
| Web fonts (Inter, JetBrains Mono) | Google Fonts | browser-direct | none | browser cache | UI typography |
| Postgres | Heroku Postgres | server | `DATABASE_URL` (paid add-on) | — | users, incidents, share links, watchlist, lightning history, snapshots, IAP PDFs |

## Provider policies worth knowing

- **Identifying User-Agent.** NWS, Nominatim, CelesTrak and adsb.fi ask callers to identify themselves. The server sends `NWS_USER_AGENT` to all of them; when the variable is unset the default string carries no contact address, which does not satisfy the NWS or Nominatim policies.
- **Polling limits.** adsb.fi asks for roughly one request per second (honoured with sequential 150 ms spacing), CelesTrak asks for TLEs to be cached for hours (2-hour cache, honoured), Nominatim allows about one request per second (24-hour search cache; intel geocoding budgeted at 16 lookups per 90-second cycle with 1.1-second spacing), and GDELT rate-limits shared Heroku IP addresses (10-minute cache and in-flight coalescing).
- **Unofficial sources.** Three feeds have no published API contract: the Blitzortung relays (used the way the public lightningmaps.org client uses them), the PulsePoint web-app endpoint (decrypted with a static passphrase recovered from its public client), and the CruiseMapper ship pages (HTML scraping behind Cloudflare). Each can stop working without notice, and each is explicitly flagged as fragile in the code.
- **Geographic coverage.** LANDFIRE fuels and AirNow/PurpleAir AQI are CONUS-only; HMS smoke covers North America; NWS alerts, NWPS gauges, NIFC incidents and the outage feeds are US-only; FIRMS, NHC/JTWC, earthquakes, lightning, wind, flights, ships, satellites and GDELT are global.


# Capability Maturity and the MVP Feature Set

The code review catalogued 303 distinct capabilities across twelve subsystems and rated each one by the state of its implementation. The result is a platform that is far more complete than a typical minimum viable product: 253 capabilities (84%) are production-ready, 34 are working but rough, 13 are partial, and 3 are scaffolds with no function behind them.

<div class="stat-row"><div class="stat"><div class="n">303</div><div class="l">Capabilities</div></div><div class="stat"><div class="n">84%</div><div class="l">Production-ready</div></div><div class="stat"><div class="n">~90</div><div class="l">Data feeds</div></div><div class="stat"><div class="n">1</div><div class="l">Dyno to run it</div></div></div>

## Maturity by subsystem

| Subsystem | Production | Rough | Partial | Scaffold | What is not production-grade |
|---|---|---|---|---|---|
| Globe shell and chrome | 29 | 5 | 2 | – | search has no typeahead; render-quality controls are dead code; hidden Google 3D layer; login-screen telemetry is decorative |
| Hazard layers (alerts, quakes, fire, smoke, AQI, outlook) | 21 | – | 2 | – | earthquake period filter has no UI; six of seven layers lack an on-map legend |
| Movement layers (flights, satellites, ships, hurricanes, lightning, rivers, outages) | 29 | 3 | – | – | ship positions depend on a fragile scrape; hurricane feed has no server cache; satellites never re-fetch TLEs while on |
| Environmental layers (radar, precip, wind, fuel, 3D, time zones, pins) | 17 | 4 | 4 | – | radar recolour pipeline is a workaround; IR "Combined" mode uncalibrated; directions panel uses public demo servers; news/intel pins hidden from the operator app |
| Analytics (dashboard, threat score, Property Watch, risk report, fuel analyzer) | 14 | 6 | – | – | risk report is wildfire-only and print-only; property list is hardcoded; no background monitoring or alerting |
| Crisis lifecycle (incident record, tabs, sync, stand-down) | 36 | 1 | 2 | 1 | one checklist and intake template for all 26 incident types; Resource Tracker and Comms Log are placeholders; complexity selector hidden |
| Crisis sharing and reporting (share links, viewer, AAR) | 34 | 2 | – | – | AAR and reports are browser-print only; AAR only after archive |
| Server core (auth, admin, cache, boot, deploy) | 14 | 5 | 1 | – | no token revocation or role management; proxy-unaware rate limit; required env vars undocumented; unit tests only |
| Server crisis API | 22 | 1 | – | – | no rate limiting on public share or briefing routes |
| Server hazard routes | 12 | 1 | – | – | temporary radar diagnostic endpoint still shipped |
| Server movement and geography routes | 17 | 2 | – | 2 | two dead routes (directions, drive); ship sources fragile |
| Server intel and news | 8 | 4 | 2 | – | news geolocation is a 95-entry gazetteer; intel buffer is ephemeral; no alerting |

## The recommended MVP

The MVP question for this product is not "what must be built" but "what should be switched on, hardened and supported for a first customer". The recommendation below keeps everything that is production-ready and load-bearing, flags what ships with a caveat, and defers what is fragile or half-wired.

### Core — ship and support

- **Globe and shell**: five basemaps including daily MODIS imagery, dockable panels with the mobile deck, sidebar, legends, provenance popover, search, measure tool, screenshot and fullscreen.
- **Hazard monitoring**: NWS alerts, USGS earthquakes, FIRMS hotspots, NIFC named fires and perimeters, HMS smoke, NWCG 7-day fire potential, RainViewer radar with timeline, WPC precipitation forecast, GFS wind (particles, streamlines, probe), NHC/JTWC tropical, Blitzortung lightning (live and 24-hour history), NWPS river gauges, multi-state power outages.
- **Air quality** with AirNow and PurpleAir — provided the two free keys are provisioned, since the layer is empty without them.
- **Asset awareness**: property pins, the ADS-B roster (company aircraft, hurricane hunters, fire tankers) with trails and takeoff/landing events, the satellite tracker and ISS mode.
- **Decision support**: Property Watch proximity scan, the Property Status Dashboard with its explainable threat score and live feed, the duty-officer briefing (rules digest by default; Claude when a key is set), the Property Wildfire Risk Report, and the LANDFIRE fuel-zone analyzer.
- **Crisis response**: the full incident workspace — situation report, action log with system events, ICS org chart, checklists, intake, map drawing, vessel attachment — with multi-operator live sync, share links with password, expiry, revocation and access log, the IAP library, stand-down and reopen, and the after-action report.
- **Platform**: invite-code authentication, admin panel, Heroku deployment, CI typecheck/test/build.

### Included with a stated caveat

- **Fleet vessel tracking.** The default free path (community AIS plus a CruiseMapper scrape) sees the fleet intermittently and can be blocked without notice; a paid VesselFinder or MyShipTracking key is the only dependable source and should be budgeted (the code estimates roughly €85/month at two-hour polling).
- **Breaking News and the Intel Feed.** Both work today, but severity and category are keyword heuristics, the intel buffer empties on every restart, and two of the built-in sources (PulsePoint, CHP) have no API contract. Position them as beta.
- **Screensaver tours.** Production-quality and valuable on wall displays, but non-essential; no idle auto-start exists.
- **Location details panel** (nearest hospital, hotel, police, fire; drive routes). Depends on volunteer Overpass and OSRM demo servers called from the browser; results are labelled as estimates.

### Defer past the MVP

- The hidden Google Photorealistic 3D Tiles layer (metered API, key would be baked into the bundle).
- The GDELT news map and intel pins on the operator globe (currently reachable only on share pages).
- Resource Tracker and Comms Log tabs (placeholders), the ICS complexity selector (hidden), per-type checklist and intake templates (only the vessel-grounding template exists).
- Dead code that should be removed before release: the `/api/directions` and `/api/drive` routes, the viewport-flights client path, the render-quality store, and the temporary radar diagnostic endpoint.

### MVP readiness gates

Feature scope is not the constraint on shipping; the security posture is. The companion bug report lists the findings that should be closed before the MVP is exposed to a customer. The most important are session revocation on user deletion, the share-link password gate accepting the stored hash as a key, plaintext share passwords returned to every signed-in user, the unauthenticated briefing route that can drive paid model calls, the news endpoint that fetches arbitrary URLs, the proxy-unaware login rate limiter, and documenting the two required environment variables so a fresh deployment does not fail silently. None of them is architecturally difficult; together they are days of work, not months.


# Known Limitations

These are the boundaries of the platform as built. They are not defects — the bug report covers those — but they shape what the product can promise today and where the roadmap should go.

## Single-tenant by construction

The monitored properties (31 locations in 13 groups), the seven-ship fleet, the ten tracked aircraft, the checklist and intake templates, the six national parks in the news ticker and the AI briefing's system prompt are all constants in source code. Adding a property or a vessel means a code change and a redeploy. There is no property register, no asset database and no tenant boundary; the same fleet roster is duplicated in three places that must be kept in sync by hand.

## Single-process by design

The shared cache, the authentication failure counter, both Server-Sent Events fan-outs, the intel buffer and every background collector live in the memory of one Node process. The code says so explicitly and names Redis as the prerequisite for a second dyno. Until then, horizontal scaling is not available, and every restart empties the caches and the intel feed.

## Monitoring is pull-only

Nothing in the platform pushes. The dashboard scans only while it is open, threat scores have no history, the intel engine has no keyword or geofence alerts, and there is no email, SMS, Slack or push notification path. An operator must be looking at the screen to learn that a property's status changed.

## Coverage is US-centric

LANDFIRE fuels and both air-quality sources are CONUS-only; HMS smoke covers North America; NWS alerts, NWPS gauges, NIFC incidents and the outage feeds are US-only, and the outage aggregator covers about nineteen states from hand-picked utilities. The wildfire risk report therefore degrades to "unavailable" sections for international assets, and the fleet — which sails internationally — is covered only by global feeds (tropical cyclones, lightning, wind, earthquakes, GDELT news).

## Analysis depth

The threat score is an additive, uncalibrated heuristic by design. The property risk report implements one hazard (wildfire) and explicitly omits relative humidity, fuel moisture and terrain slope. The fuel-zone score uses app-defined weights rather than published fire-behaviour outputs and does not adjust for live wind or moisture. The wind grid is five degrees, too coarse for isobars or further environmental fields. Several dashboard signals evaluate only each group's first location.

## Reporting is browser-print

Every report — the after-action report, the property risk report, the incident archive — is produced through the browser's print dialog with a print stylesheet. There is no server-side PDF engine, no persisted report, and no structured export of AAR data, checklist history or the access log.

## Crisis workflow gaps

One checklist template and one intake questionnaire serve all 26 incident types. There is no operational-period object, no resource tracking and no communications log. Lifecycle transitions are unenforced (an operator can jump from Monitoring to Closed), system audit entries can be deleted while an incident is live, the personnel pool is re-entered per incident, and blob fields (executive summary, org chart, drawings) remain last-write-wins between concurrent operators.

## Identity and administration

Accounts are gated by one shared signup code. There is no password reset, email verification, multi-factor authentication, role promotion or account disablement; the only admin actions are listing users, deleting them and rotating the code. Sessions are 30-day tokens verified by signature alone.

## Operational transparency

Two required environment variables and eight optional keys are not documented in the repository's example file or Heroku manifest; a deployment created from the manifest alone fails every authenticated call. README statements about server-side alert geometry and viewport-based flight refresh describe code that no longer exists.

## Test coverage

Twenty-two unit-test files cover pure logic — sync canonicalisation, checklist merges, AAR metrics, measurement math, the flight state machine, the cache. No test exercises an HTTP route, authentication, the migration, a map layer component or the intel adapters, and CI has no database, so the DB-backed code paths run untested.


