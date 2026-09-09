# GSOC Monitor

Global Situational & Operational Conditions Monitor — a real-time 3D globe dashboard built with CesiumJS, React, and Node/Express.

## Phase 1 features

- **3D globe** — CesiumJS with starfield, real sun lighting (day/night terminator), dark/light/satellite/topo basemaps plus an Earth map type: NASA's daily MODIS true-color mosaic with an AM/PM (Terra/Aqua) toggle and a date picker back to Feb 2000.
- **Precipitation radar** — RainViewer animated tiles with adjustable 30/60/120-min playback window and opacity control.
- **Earthquakes** — USGS live feed, magnitude-scaled colored points, click for details panel.
- **NWS Weather Alerts** — every active alert, including zone/county-based ones (winter, heat, flood, red-flag) resolved to polygons server-side; severity-coded overlays with full alert text in click panels.
- **Live flights** — adsb.fi ADS-B (free, no key), plane icons rotated to heading, favorites list, auto-refresh when camera moves.
- **Satellites** — CelesTrak TLE + satellite.js SGP4 propagation; real-time orbits for Space Stations / Brightest / GPS / Weather / Starlink groups, click any satellite to trace its orbit ring and read live position, altitude, speed, and orbital elements.
- **Search** — geocode (Nominatim), raw lat/lon input, auto-fly to results.
- **Dockable panels** — any entity click opens a draggable/resizable detail window; multiple can be open at once.

## Quick start (local dev)

```bash
# 1. Copy and fill in env vars
cp .env.example .env
# at minimum set NWS_USER_AGENT to "your-app-name (your@email.com)"

# 2. Install all workspaces
npm install

# 3. Start backend (in one terminal)
npm run dev:server

# 4. Start frontend (in another terminal)
npm run dev:client
# → opens http://localhost:5173
```

## API keys / accounts

| Service | Required? | Notes |
|---|---|---|
| adsb.fi (flights) | No key needed | Free open ADS-B data, ~1 req/sec (the server caches to stay under it). |
| NWS (api.weather.gov) | No key needed | Set `NWS_USER_AGENT` to identify your app per NWS policy: `"my-app (me@email.com)"`. Used for both alerts and zone-geometry lookups. |
| USGS Earthquakes | No key needed | Fully public. |
| CelesTrak (satellites) | No key needed | Public TLE data; the server caches each group for 2h per CelesTrak's guidance. |
| RainViewer | No key needed | Fully public tile CDN. |
| NASA GIBS (Earth basemap) | No key needed | Public WMTS tiles of the daily MODIS Terra/Aqua true-color mosaic, fetched straight from the browser (no server involvement). |
| Nominatim (geocoding) | No key needed | Uses OSM data; `NWS_USER_AGENT` string is also used here as User-Agent per their policy. |

## Deploy to Heroku

```bash
# 1. Create the app (one time)
heroku create your-app-name

# 2. Set required env vars
heroku config:set NWS_USER_AGENT="gsoc-monitor (you@email.com)"

# 3. Push and deploy
git push heroku main   # or: heroku git:push ...

# 5. Open it
heroku open
```

Heroku's Node buildpack will run `npm install` then `npm run build` (which builds both client and server), then `npm start` (which runs the Express server that serves the built client as static files).

> **Cost note**: Heroku no longer has a free tier. The smallest paid plan is "Eco" (~$5/month for 1 dyno). All data fetching is done server-side/client-side via free public APIs, so there are no additional API costs to start.

## Project structure

```
gsoc-monitor/
├── Procfile                  # Heroku: web: npm start
├── app.json                  # Heroku app manifest
├── client/                   # React + Vite + CesiumJS frontend
│   └── src/
│       ├── cesium/           # Globe, basemaps, camera helpers
│       ├── layers/           # earthquakes/, alerts/, radar/, flights/
│       ├── panels/           # Dockable window framework
│       ├── store/            # Zustand stores (layers, settings)
│       └── ui/               # Sidebar, SearchBar, TopBar, etc.
└── server/                   # Express proxy/cache API
    └── src/routes/           # earthquakes, alerts, radar, flights, geocode
```

## Ship positions and AIS coverage

Every position source that is configured gets polled on each cycle, and the
best answer per ship wins: a source that states *when* the ship reported beats
one that does not, then the newer fix, then coverage rank. A position is only
accepted if it is newer than the one held and the implied speed is realistic,
so a feed re-serving an old port call cannot move a vessel backwards.

Coverage is what decides whether a ship can be seen at all:

| Reception | Who hears it | Where it works |
|---|---|---|
| Terrestrial | Shore-based receivers (this is all free AISStream carries) | Coastal waters |
| Satellite | Low-earth-orbit receivers | Global, reports every few hours |
| Roaming | Relayed by another vessel in a partner fleet | Fills open-ocean and congested gaps |

A fleet that stays inshore is fine on the free sources. A fleet that crosses
oceans needs a source carrying satellite or roaming AIS, otherwise a vessel
will sit at her last coastal position for days and the app has no way to know
a better position exists. Set `MARINETRAFFIC_API_KEY` (or
`VESSELFINDER_API_KEY` with their satellite add-on) to close that gap.

`GET /api/ships/debug` shows which source supplied each ship's position, how it
was received, how old the fix is, what every other source said about her on the
last cycle, and every fix that was refused with the speed it would have implied.

## Adding more layers

The architecture is designed for easy extension. For each new layer:
1. Add a new `LayerId` to `client/src/types/index.ts`
2. Add a `CustomDataSource`-based layer component under `client/src/layers/`
3. Register a detail component in `PanelManager.tsx`
4. Add a proxy route under `server/src/routes/`
5. Add a toggle to `Sidebar.tsx`

Shipped since: hurricanes (NOAA NHC), lightning (Blitzortung), FIRMS fire hotspots, ships (AISStream), satellite tracker (CelesTrak TLE + satellite.js), the Earth map type (NASA MODIS Terra/Aqua daily true color via GIBS — AM/PM passes, date-steppable back to 2000).
