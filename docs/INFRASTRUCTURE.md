# Infrastructure & Data Inventory

Where every piece of data lives, and every external service the app talks to.
Derived from the source tree; regenerate by re-auditing when routes or storage change.

---

## 1. Hosting & deployment chain

| Stage | What | Where it's configured |
|---|---|---|
| Source | GitHub `alecbibat/gsoc-monitor` | `git remote -v` |
| CI | GitHub Actions — typecheck, test, build on **every push** | `.github/workflows/ci.yml` |
| Deploy | Heroku auto-deploy from GitHub | **Heroku dashboard only — not in this repo** |
| Runtime | Single Heroku `web` dyno, Node buildpack, `basic` size | `Procfile`, `app.json` |
| Build | `npm run build` → Vite client bundle + `tsc` server | root `package.json` |
| Serve | Express serves the built React app from `client/dist` as static files | `server/src/index.ts` |

One process does everything: API, static hosting, background pollers, and websocket clients.
There is no separate worker dyno, queue, or Redis. The in-memory cache
(`server/src/cache.ts`) explicitly assumes a single dyno.

> **Not in version control:** the Heroku app name, its Config Vars, the GitHub↔Heroku
> auto-deploy setting, and the Cloudinary account settings. Those live in the
> respective dashboards.

---

## 2. Persistent storage — three places

### 2a. Heroku Postgres (`DATABASE_URL`) — the system of record

The only durable, authoritative store. Schema is created/updated on every boot by
`server/src/migrate.ts` (idempotent, runs with retry/backoff; a DB outage degrades
DB-backed routes but does not take the dyno down).

| Table | Holds | Sensitivity |
|---|---|---|
| `users` | email, name, **bcrypt password hash** (cost 12), role | Credentials |
| `settings` | key/value — `signup_code`, `iap_seeded` | Access control |
| `incidents` | Whole incident record as **JSONB** — action logs, ICS role assignments, **personnel names, titles, phone numbers, email addresses**, checklists, intake answers | **PII** |
| `share_links` | Public share token, full incident **snapshot JSONB**, SHA-256 password hash, `expires_at`, `label`, `revoked_at` | **PII, externally reachable** |
| `share_access_log` | token, timestamp, **viewer IP address**, user agent | **PII / audit** |
| `watchlist_sources` | OSINT source definitions (URL, kind, config) — *sources only, never the items* | Low |
| `lightning_chunks` | Gzipped binary strike history (`BYTEA`), ~290 rows/day, pruned to a 24h window | Low |
| `snapshots` | Small key/value JSONB: the ~80 KB wind grid (`wind-grid`), the flight tracker's last-known positions and trails (`flights:v1`), and the fleet's last accepted ship fixes and 72h trails (`ships:v1`) | Low |
| `iap_documents` | **Incident Action Plan PDFs stored as `BYTEA`**, 15 MB cap, one per incident type + a general default | Operational |

PDFs go in Postgres rather than object storage for two stated reasons: the dyno
filesystem is wiped on deploy, and the Cloudinary preset is image-only.

### 2b. Cloudinary — **all photos**

- **Account/cloud:** `domztu6qv` · **Unsigned upload preset:** `gsoc-monitor`
- **Code:** `client/src/lib/cloudinary.ts` → `https://api.cloudinary.com/v1_1/domztu6qv/image/upload`
- **Flow:** the **browser uploads directly** to Cloudinary. The server never sees the image bytes. Only the returned `secure_url` is stored in Postgres.
- **Two callers:**
  1. `client/src/crisis/ActionLog.tsx` — photo attachments on incident action-log entries
  2. `client/src/crisis/CrisisDrawController.tsx` — map-snapshot thumbnails captured when an operator finishes drawing a crisis layer
- **Legacy:** older entries may still carry inline base64 JPEGs (≤1200px) rather than a URL — hence the 50 MB body limit on `/api/crisis`.

Notes worth knowing:
- The cloud name and preset are **hardcoded in client source** and shipped in the bundle. That is how unsigned uploads work (they are not secrets), but it does mean **anyone who reads the bundle can upload to that preset**. Cloudinary-side controls (folder restriction, moderation, rate limits, allowed formats) are the only guard.
- Uploaded images are served from Cloudinary's CDN and are reachable by URL — including from share links, which are viewable without an account.
- The preset is **image-only**; PDFs therefore go to Postgres instead.

### 2c. Dyno local filesystem — ephemeral, by design

| File | Written by | Lifetime |
|---|---|---|
| `ships-snapshot.json` (`SHIPS_SNAPSHOT_PATH`) | `server/src/routes/ships.ts`, ≤ once per 30 s after an accepted fix | Local-dev fallback only (no `DATABASE_URL`). On Heroku the dyno filesystem is **wiped on every restart and deploy**, so the authoritative copy is the `ships:v1` row in the `snapshots` table. Snapshots older than 7 days are ignored on restore. |

This is the only file the app writes. Ship positions are restored from Postgres
at boot so a restart neither empties the map nor lets the first scrape after
boot overwrite a fresher fix (see the acceptance rules in `ships.ts`:
positions are ordered by fix time and implausible jumps are refused; both are
visible at `/api/ships/debug` under `fixes`).

### In-memory only (lost on every restart)

TTL cache (`cache.ts`, 2000-entry cap), the OSINT intel rolling buffer (800 items,
36h max age — **items are never persisted**), SSE client sets, and the auth
failed-login rate-limit map.

### Browser storage (per user, per device)

`localStorage`: `gsoc-layers`, `gsoc-sidebar-sections`, `gsoc-crisis-dock`,
`gsoc-perf`, `gsoc-news`, `gsoc-wind-unit`, the wind grid cache, `ss-voice`,
`gsoc-share-name`.
`sessionStorage`: Cesium reload guard, share-link view keys, stale-chunk reload latch.

---

## 3. Authentication

- **JWT** in an `httpOnly` cookie named `gsoc_auth`, 30-day expiry, signed with `JWT_SECRET`. `secure` flag only set when `NODE_ENV=production`. `sameSite: lax`.
- **Passwords:** bcrypt, cost 12 (`bcryptjs`, pure JS).
- **Signup is gated by a shared code** stored in `settings.signup_code` — set from `SIGNUP_CODE` (authoritative, re-applied on every boot) or randomly generated once and printed to the logs.
- **First registered user automatically becomes admin.**
- In-memory brake: 10 failed attempts per IP per 10 minutes.
- **Share links bypass auth entirely** — they're public URLs, optionally password-gated (SHA-256), with TTL, labels and revocation. Every open is logged with IP + user agent.

---

## 4. Third parties that need a key, an account, or money

| Service | Env var | Used for | Cost |
|---|---|---|---|
| **Heroku** | — | Hosting + Postgres add-on | Paid (dyno + DB plan) |
| **Cloudinary** | hardcoded cloud/preset | All incident photos + map thumbnails | Free tier / paid by usage |
| **Google Maps Platform** | `VITE_GOOGLE_MAPS_KEY` | Photorealistic 3D tiles (Map Tiles API). Baked into the bundle at build time. | **Billable per usage** |
| **Cesium ion** | `VITE_CESIUM_ION_TOKEN` | World Terrain + OSM Buildings. Falls back to the rate-limited demo token. | Free tier |
| **AISStream** | `AISSTREAM_API_KEY` | Live ship AIS over `wss://stream.aisstream.io` | Free |
| **VesselFinder** | `VESSELFINDER_API_KEY` | Optional paid AIS by IMO | Paid |
| **MyShipTracking** | `MYSHIPTRACKING_API_KEY` | Optional paid AIS alternative | Paid |
| **PurpleAir** | `PURPLEAIR_API_KEY` | Air quality sensors | Paid/registered |
| **AirNow** | `AIRNOW_API_KEY` | EPA air quality | Free, registration |
| **NPS Data API** | `NPS_API_KEY` | Park news/alerts. Defaults to `DEMO_KEY` (rate-limited). | Free |

Other env vars: `PORT`, `NODE_ENV`, `NWS_USER_AGENT` (contact string required by NWS
and Nominatim policy), `SHIPS_SCRAPE_CRUISEMAPPER`, `SHIPS_POLL_MINUTES`,
`SHIPS_SNAPSHOT_PATH`, `AIS_MMSI_FILTER`.

> **`VITE_*` vars are build-time.** They are compiled into the public JavaScript
> bundle and are readable by anyone. They must be set in Heroku **before** the build
> runs. Treat them as public identifiers, and restrict them at the provider
> (HTTP-referrer restrictions on the Google key, in particular).

---

## 5. Keyless public feeds

### Server-side (proxied and cached through Express)

| Route | Upstream |
|---|---|
| `/api/alerts` | api.weather.gov (NWS) |
| `/api/earthquakes` | earthquake.usgs.gov |
| `/api/radar` | api.rainviewer.com |
| `/api/flights` | opendata.adsb.fi |
| `/api/geocode` | nominatim.openstreetmap.org |
| `/api/satellites` | celestrak.org |
| `/api/rivers` | api.water.noaa.gov |
| `/api/wind` | api.open-meteo.com, api.met.no |
| `/api/lightning` | `wss://ws1/ws7/ws8.blitzortung.org` |
| `/api/smoke` | satepsanone.nesdis.noaa.gov |
| `/api/fire-outlook` | fsapps.nwcg.gov |
| `/api/jtwc-invests` | metoc.navy.mil |
| `/api/news` | BBC, NPR, Sky News, Al Jazeera, Guardian RSS |
| `/api/news-map` | api.gdeltproject.org |
| `/api/county`, `/api/park` | ArcGIS feature services |
| `/api/park-news` | developer.nps.gov |
| `/api/directions`, `/api/drive` | router.project-osrm.org, overpass-api.de |
| `/api/outages` | ArcGIS · **KUBRA Storm Center** (kubra.io) · NISC co-op maps (outagemap-data.cloud.coop) — 9 named utilities |
| `/api/ships` | aisstream.io · **CruiseMapper scraped by IMO** (free fallback, behind Cloudflare) · optional paid AIS |
| aircraft info | api.adsbdb.com (registry) + **api.planespotters.net (airframe photos, hotlinked)** |

### OSINT intel ingest (`/api/intel`, refreshes every 90s)

news.google.com RSS · cad.chp.ca.gov + media.chp.ca.gov (CHP dispatch) ·
api.pulsepoint.org / web.pulsepoint.org (fire/EMS CAD) · Socrata open-data portals
(e.g. Chicago crime) · Bluesky public API · Nominatim for geocoding (budget-capped
at 16 new lookups/cycle per their usage policy).

**Items are never written to a table** — only the *sources* persist, in
`watchlist_sources`. The feed itself is an in-memory rolling buffer.

### Browser-direct (never touches the server)

server.arcgisonline.com (dark/light/satellite basemaps) · tile.openstreetmap.org ·
opentopomap.org · gibs.earthdata.nasa.gov (NASA MODIS daily true-color) ·
mapservices.weather.noaa.gov · nhc.noaa.gov · services3/9.arcgis.com ·
fsapps.nwcg.gov · api.bigdatacloud.net · tile.googleapis.com · ion.cesium.com ·
api.cloudinary.com · cdn.jsdelivr.net.

Because these are fetched by the browser, **every client's IP is exposed directly to
those providers**, and they are unaffected by any server-side caching or rate limiting.

---

## 6. Observations

Not bugs — things worth a deliberate decision.

1. **Share links are the widest attack surface.** They are unauthenticated URLs carrying a full incident snapshot, including personnel names, phone numbers, emails, and Cloudinary photo URLs. Mitigations already present: optional SHA-256 password, TTL, revocation, and an IP-logging access table. Worth confirming the default TTL matches policy.
2. **Cloudinary images are public URLs.** Anyone with the link can fetch an incident photo without authenticating, indefinitely, even after the share link is revoked or the incident deleted. Nothing in the app deletes Cloudinary assets.
3. **The unsigned upload preset is world-writable.** Cloud name + preset are in the shipped bundle. Consider folder scoping, allowed formats, and an upload rate limit in the Cloudinary console.
4. **`VITE_GOOGLE_MAPS_KEY` is public and billable.** It ships in the JavaScript bundle. Apply HTTP-referrer restrictions and a quota cap in Google Cloud.
5. **`share_access_log` accumulates IP addresses with no retention policy.** Every other high-volume table is pruned; this one is not.
6. **Single dyno with no shared cache.** Scaling past one web dyno will break the in-memory TTL cache, the intel buffer, the lightning collector, and SSE fanout — all of which assume one process. `cache.ts` notes this explicitly.
7. **The README is out of date.** It describes "Phase 1" and lists only keyless feeds. It predates the database, auth, incidents/crisis system, IAP library, and OSINT intel.
8. **CruiseMapper is scraped, not APIed.** It sits behind Cloudflare and may be blocked; check `/api/ships/debug`. Worth confirming it's acceptable under their terms.
9. **A hardcoded PulsePoint passphrase** (`server/src/intel/adapters.ts`) is the publicly known constant for decrypting their public CAD feed — not a secret of ours, but it does mean the feed depends on an undocumented interface.
