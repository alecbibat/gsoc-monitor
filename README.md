# GSOC Monitor

Global Situational & Operational Conditions Monitor — a real-time 3D globe dashboard built with CesiumJS, React, and Node/Express.

## Phase 1 features

- **3D globe** — CesiumJS with starfield, real sun lighting (day/night terminator), dark/light/satellite/topo basemaps plus an Earth map type: NASA's daily MODIS true-color mosaic with an AM/PM (Terra/Aqua) toggle and a date picker back to Feb 2000.
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

## Authentication & SSO

Sign-in has two paths that both end at the same session cookie, so every data
route is unchanged by SSO.

| | How it works |
|---|---|
| **Email + password** | bcrypt (cost 12). Governed by `PASSWORD_LOGIN_MODE`. |
| **Single sign-on** | OIDC authorization-code flow with PKCE. Enabled once `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` are all set. |

### Setting up SSO

Ask IT for **OIDC**, not SAML — the callback is an ordinary redirect, which
avoids the cross-site-POST cookie problems a SAML ACS endpoint runs into.

**Give IT:** the callback URL `https://<your-app>/api/auth/sso/callback`, and
the claims needed — `sub`, `email`, `email_verified`, `name`.
**Get back:** issuer URL, client ID, client secret → set as Heroku Config Vars
(see `.env.example`). Set `SSO_ALLOWED_DOMAINS` too.

Accounts are matched to IdP identities **by email, once**. An admin pre-creates
the account (Admin panel → Team members → *Add member*, no password); the
person's first SSO login attaches their IdP subject to that row and every login
after matches on the subject instead. Because linking updates the existing row,
the user's id is stable — nothing they authored gets orphaned when their email
or name later changes.

### Rolling it out

`PASSWORD_LOGIN_MODE` walks the migration through three states:

1. **`all`** (default) — passwords and SSO both work. Existing users are
   unaffected; anyone who signs in via SSO is silently linked.
2. **`admin-only`** — only admins can use a password. Everyone else must use
   SSO. Set `SIGNUP_ENABLED=false` here too.
3. **`off`** — passwords disabled entirely. **Not recommended for this app:** an
   IdP outage is exactly the kind of incident the dashboard exists to
   coordinate, so keep at least one break-glass admin password.

### Share links

Share links require a signed-in account. The generated link password is **not**
accepted by default — an admin opens a time-boxed window (Admin panel →
Share-link access) when SSO is unavailable and a situation report still has to
reach people. It expires on its own (default 12h, max 72h) and every open is
logged with the viewer's account.

## Project structure

```
gsoc-monitor/
├── Procfile                  # Heroku: web: npm start
├── app.json                  # Heroku app manifest
├── client/                   # React + Vite + CesiumJS frontend
│   └── src/
│       ├── cesium/           # Globe, basemaps, camera helpers
│       ├── layers/           # earthquakes/, alerts/, flights/
│       ├── panels/           # Dockable window framework
│       ├── store/            # Zustand stores (layers, settings)
│       └── ui/               # Sidebar, SearchBar, TopBar, etc.
└── server/                   # Express proxy/cache API
    └── src/routes/           # earthquakes, alerts, flights, geocode
```

## Adding more layers

The architecture is designed for easy extension. For each new layer:
1. Add a new `LayerId` to `client/src/types/index.ts`
2. Add a `CustomDataSource`-based layer component under `client/src/layers/`
3. Register a detail component in `PanelManager.tsx`
4. Add a proxy route under `server/src/routes/`
5. Add a toggle to `Sidebar.tsx`

Shipped since: hurricanes (NOAA NHC), lightning (Blitzortung), FIRMS fire hotspots, ships (AISStream), satellite tracker (CelesTrak TLE + satellite.js), the Earth map type (NASA MODIS Terra/Aqua daily true color via GIBS — AM/PM passes, date-steppable back to 2000).
