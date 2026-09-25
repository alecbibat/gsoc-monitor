# GSOC Monitor

Global Situational & Operational Conditions Monitor — a real-time 3D globe dashboard built with CesiumJS, React, and Node/Express.

## Phase 1 features

- **3D globe** — CesiumJS with starfield, real sun lighting (day/night terminator), dark/light/satellite/topo basemaps plus an Earth map type: NASA's daily MODIS true-color mosaic with an AM/PM (Terra/Aqua) toggle and a date picker back to Feb 2000.
- **Precipitation radar** — RainViewer's global composite as a zoom.earth-style 30 min / 1 h / 2 h loop of 10-minute frames, repainted in Classic or Vivid (snow in a pale ramp of its own) or RainViewer's palette (its cyan-blue snow); place labels stay on top. The loop only plays through frames loaded for the current view, crossfading between them (stepped frames on low-end GPUs and under reduced motion, which also skips autoplay). Scrub the timeline or use Space and the arrow keys; hover the map for the intensity under the cursor.
- **Earthquakes** — USGS live feed, magnitude-scaled colored points, click for details panel.
- **NWS Weather Alerts** — every active alert, including zone/county-based ones (winter, heat, flood, red-flag) resolved to polygons server-side; severity-coded overlays with full alert text in click panels.
- **Live flights** — adsb.fi ADS-B (free, no key), plane icons rotated to heading, favorites list, auto-refresh when camera moves.
- **Satellites** — CelesTrak TLE + satellite.js SGP4 propagation; real-time orbits for Space Stations / Brightest / GPS / Weather / Starlink groups, click any satellite to trace its orbit ring and read live position, altitude, speed, and orbital elements.
- **Time zones** — real zone polygons (timezone-boundary-builder / OpenStreetMap, ODbL) with a live clock on every zone, to the second, daylight-saving aware; boundaries are rebuilt from a release with `npm run build:timezones`.
- **Search** — geocode (Nominatim), raw lat/lon input, auto-fly to results.
- **Dockable panels** — any entity click opens a draggable/resizable detail window. Only one is open at a time: the next click replaces it, unless you lock a window (the padlock next to its close button), in which case it stays put and several can be kept open together. Windows you open on purpose rather than by clicking the map (the sidebar widgets, Property Watch pop-outs, fuel-zone results) start locked.

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
| RainViewer (radar) | No key needed | Public manifest + tile CDN. The free tier is licensed for personal/educational use; attribution "Weather data by RainViewer" is shown in the radar legend. It serves zoom levels up to 7 and about 100 requests per IP per minute — see [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md#rainviewer-radar-tiles) for how the layer stays within that. |
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
the account (Admin → Team members → *Add member*, no password); the
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
accepted by default — an admin opens a time-boxed window (Admin →
Sign-up & share access) when SSO is unavailable and a situation report still has to
reach people. It expires on its own (default 12h, max 72h) and every open is
logged with the viewer's account.

## Crisis response templates

Each incident's **ICS role checklists**, **intake questions** and **Incident
Action Plan** come from admin-managed templates, layered by scope:

**General** (every incident) → **Incident type** → **Property** → **Type + Property**

An incident of type *Wildfire* at *Grand Canyon* sees the General items, then
the Wildfire items, then the Grand Canyon items, then anything written for
that exact combination; each item carries a small chip naming the scope it
came from. The IAP is the single most specific PDF on file (type + property,
then type, then property, then the general default).

Admins edit all of this on the **Admin** page (user menu → Admin): Checklists,
Intake questions, IAP documents and Checklist roles (including the GSOC
Support role). Built-in defaults ship for every incident type and property
(`server/src/data/crisisTemplateDefaults/`); an admin's change to a scope is
stored as an override of that scope (`crisis_template_overrides`) and *Reset to
default* removes it. Saves carry the revision they were based on, so two
admins can't silently overwrite each other, and open incidents and share links
pick up changes live.

Checklist and intake state is keyed by stable item ids. If an incident's type
or property changes, or an admin removes an item, anything already checked or
answered stays visible (read-only) under *Earlier checklist items* / *Other
answers*, so the record an after-action review relies on is never lost. When
editing defaults in code, append new lines rather than reordering: ids are
minted from position.

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

## Refreshing time-zone boundaries

The Time Zones layer draws polygons from the
[timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder)
project (OpenStreetMap data, ODbL). They ship with the app as
`client/public/data/timezones.topo.json`, generated by:

```bash
npm run build:timezones                     # latest release
npm run build:timezones -- --release 2026d  # a specific release
```

The script downloads the "with oceans, now" variant (one polygon per set of
places whose clocks agree from today on), simplifies it to ~1 km with mapshaper
(topologically, so shared borders stay shared), resolves the release's
deliberate overlaps in favour of the smaller zone, cuts every zone on a 45°×90°
grid (Cesium 1.142 tessellates larger parts twice), verifies the result (every
zone present, no oversized part, a 0.5° world grid fully covered with no point
in two zones), and writes the TopoJSON plus
`client/src/layers/timezones/timezones.meta.json` (release, date, attribution —
shown in the UI). It takes a minute or two and ~6 GB of RAM. Re-run it after a
tz database release that moves a border; clocks and daylight-saving rules come
from each browser's own tz database and need no rebuild.

## Adding more layers

The architecture is designed for easy extension. For each new layer:
1. Add a new `LayerId` to `client/src/types/index.ts`
2. Add a `CustomDataSource`-based layer component under `client/src/layers/`
3. Register a detail component in `PanelManager.tsx`
4. Add a proxy route under `server/src/routes/`
5. Add a toggle to `Sidebar.tsx`

Shipped since: hurricanes (NOAA NHC), lightning (Blitzortung — the server records every strike around the clock, flagging any blind spot such as a restart's minute or two, and the globe opens on the last 24 h as age-colored X marks with live strikes on top), FIRMS fire hotspots, ships (AISStream), satellite tracker (CelesTrak TLE + satellite.js), the Earth map type (NASA MODIS Terra/Aqua daily true color via GIBS — AM/PM passes, date-steppable back to 2000).
