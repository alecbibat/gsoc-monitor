# GSOC Monitor

Global Situational & Operational Conditions Monitor — a real-time 3D globe dashboard built with CesiumJS, React, and Node/Express.

## Phase 1 features

- **3D globe** — CesiumJS with starfield, real sun lighting (day/night terminator), dark/light/satellite/topo basemaps.
- **Precipitation radar** — RainViewer animated tiles with adjustable 30/60/120-min playback window and opacity control.
- **Earthquakes** — USGS live feed, magnitude-scaled colored points, click for details panel.
- **NWS Weather Alerts** — severity-coded polygon overlays (Extreme/Severe/Moderate/Minor) with full alert text in click panels.
- **Live flights** — OpenSky ADS-B, plane icons rotated to heading, favorites list, auto-refresh when camera moves.
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
| OpenSky Network | Optional but recommended | Free account at opensky-network.org gives higher rate limits. Set `OPENSKY_CLIENT_ID` + `OPENSKY_CLIENT_SECRET`. Without them, anonymous calls work but are limited. |
| NWS (api.weather.gov) | No key needed | Set `NWS_USER_AGENT` to identify your app per NWS policy: `"my-app (me@email.com)"` |
| USGS Earthquakes | No key needed | Fully public. |
| RainViewer | No key needed | Fully public tile CDN. |
| Nominatim (geocoding) | No key needed | Uses OSM data; `NWS_USER_AGENT` string is also used here as User-Agent per their policy. |

## Deploy to Heroku

```bash
# 1. Create the app (one time)
heroku create your-app-name

# 2. Set required env vars
heroku config:set NWS_USER_AGENT="gsoc-monitor (you@email.com)"

# 3. Optional: higher OpenSky rate limits
heroku config:set OPENSKY_CLIENT_ID=your_id OPENSKY_CLIENT_SECRET=your_secret

# 4. Push and deploy
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

## Adding more layers

The architecture is designed for easy extension. For each new layer:
1. Add a new `LayerId` to `client/src/types/index.ts`
2. Add a `CustomDataSource`-based layer component under `client/src/layers/`
3. Register a detail component in `PanelManager.tsx`
4. Add a proxy route under `server/src/routes/`
5. Add a toggle to `Sidebar.tsx`

Planned next layers: hurricanes (NOAA NHC), lightning (Blitzortung), FIRMS fire hotspots, ships (AISStream), satellite tracker (CelesTrak TLE + satellite.js).
