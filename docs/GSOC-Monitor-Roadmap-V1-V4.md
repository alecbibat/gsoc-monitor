# GSOC Monitor — Product Roadmap Analysis: V1 through V4

# Executive Summary

GSOC Monitor already contains more capability than most products ship in their first three releases: a live multi-hazard globe fed by some ninety public sources, property- and fleet-centric threat analysis, and a complete incident-command workspace with stakeholder sharing and after-action reporting. The roadmap question is therefore not "what do we build to reach an MVP" but "in what order do we harden, open up and deepen what exists so each release is a product a customer can pay for".

This analysis proposes four versions. **V1** is the current platform with its security gate closed, fragile paths flagged and dead code removed — a trusted operating picture for one team. **V2** makes the product configurable and proactive: an asset register instead of hardcoded properties, server-side monitoring with real alerting, per-type crisis templates, a PDF engine, multi-hazard risk reports, dependable vessel tracking and the infrastructure to run on more than one dyno. **V3** adds intelligence and analytical depth: real environmental fields and live fire behaviour, natural-language intel processing with analyst workflow, historical analytics across incidents, a site asset layer and international coverage. **V4** turns the deployment into a platform: multi-tenant, single sign-on, role-based access, integrations with mass-notification and ticketing systems, and an AI copilot for incident command.

Each version is sized in relative effort, tied to the concrete gaps found in the code review, and sequenced so that data captured early (audit logs, asset records, threat-score history) is available to the analytics that come later — because data that was never captured cannot be back-filled.

# Where the Product Stands

## Strengths to build on

- **A hardened globe client.** Context-loss recovery, a GPU watchdog, visibility-aware polling, per-panel error boundaries and a consistent layer pattern mean new layers are cheap and the wall display stays up.
- **A resilient proxy tier.** Stale-on-error caching, request coalescing, background collectors with Postgres persistence for wind, flights and lightning, and boot that survives a database outage.
- **A conflict-aware crisis core.** Row-locked per-entry paths for the action log and checklists, twelve system-generated audit events, SSE fan-out to editors and viewers, share links with password, expiry, revocation and an access log, and a stand-down sequence — most of what the earlier implementation plan called "load-bearing" has landed.
- **Explainable analytics.** The threat score, proximity rings and risk-report levels are transparent and documented, which is the right foundation for calibration later.

## Constraints that shape the roadmap

- **Everything tenant-specific is compiled in.** Properties, fleet, aircraft, templates, park list, briefing prompt. This is the single biggest blocker to a second customer and to self-service.
- **Single process.** Cache, SSE fan-out, rate limiter, intel buffer and collectors are in-memory; scaling out needs Redis.
- **Pull-only.** No background monitoring, no notifications, no history.
- **US-centric data.** Fuels, air quality, alerts, gauges, outages and named fires are US or CONUS; the fleet sails internationally.
- **Browser-print reports.** No server-side PDF, no persisted or structured exports.
- **Security and stability posture.** Nine high-severity findings, concentrated in session revocation, abuse of public routes, operator sync and the wall-display recovery path (see the companion bug report).
- **Thin automated testing.** Unit tests on pure logic only; no route, database or layer tests.

# V1 — Trusted Operating Picture (the MVP)

**Goal.** Ship what exists to the first customer with confidence. No new features; close the gates.

**Scope.**

- Close the Tier 1 findings in the bug report: session revocation on delete, proxy-aware login limiting, URL validation on the news endpoint, authenticated body limits, auth and rate limit on the briefing route, removal of the hash-as-key path and plaintext share passwords, bounded lightning memo, the AirNow schema fix.
- Document every environment variable and add the Postgres add-on to the Heroku manifest so a fresh deployment works from the manifest alone; correct the README's stale claims.
- Remove dead code: the `/api/directions` and `/api/drive` routes, the viewport-flights client path, the render-quality store, the radar diagnostic endpoint. Hide the placeholder Resource Tracker and Comms Log tabs or label them clearly.
- Provision the free keys the product silently depends on (AirNow, PurpleAir, aisstream.io, NPS, Cesium ion) and decide the vessel-tracking budget (a paid by-IMO provider at roughly €85/month is the only dependable path).
- Add on-map legends for the six hazard layers that lack one, and expose the earthquake period filter — both trivial and both visible to every operator.
- Add route-level integration tests with a Postgres service in CI for auth, incidents, crisis share and checklist paths, so the Tier 2 concurrency fixes can be made safely.

**Effort.** Small: days for the security gate, about two weeks including tests and cleanup.

**What it enables.** A defensible security review, a repeatable deployment, and a base on which the Tier 2 sync fixes can be validated rather than hoped.

# V2 — Configurable and Proactive

**Goal.** Make the product a product: configurable per customer, watching in the background, alerting when it matters, and producing documents. This is the release that unlocks a second customer and removes the most-cited limitations.

## 2.1 Asset register and administration

Replace the hardcoded location, fleet and aircraft lists with database tables (property group → location, vessel, aircraft) and an admin UI to add, edit, geocode and retire assets. Derive the FIRMS envelopes, Open-Meteo batches, fleet MMSI filter and ADS-B roster from the register at runtime. Add a `tenant` column from day one even while there is one tenant. Move checklist and intake templates into the database with per-incident-type assignment and an editor, so a wildfire incident stops receiving the vessel-grounding checklist. Move the AI briefing's customer context into configuration.

*Effort: Medium–Large. Dependency: none; this is the first V2 item to start because everything else reads from it.*

## 2.2 Server-side monitoring and alerting

Move the proximity scan and threat scoring from the browser to a server job that runs every few minutes against every registered asset whether or not a dashboard is open. Persist a threat-score history per asset. Add an alert rule engine — status transitions, score thresholds, named-hazard entry into a ring, intel keyword and geofence matches — with delivery channels: email, SMS, Slack/Teams webhook and web push. Add an in-app alert inbox with acknowledgement so the wall display and the phone agree on what has been seen.

*Effort: Large. Dependency: 2.1 (assets in the database). This is the feature that turns "monitor" from a noun into a verb.*

## 2.3 Security and identity hardening

Server-side sessions or a token version so logout-everywhere and role changes are immediate; role management (promote, demote, disable); password reset by email; optional TOTP multi-factor; a general rate limiter on public routes; the share-link view key moved out of the query string; per-link ownership and named audiences; retention on the share access log. Rotate the Cloudinary preset to a signed, server-mediated upload.

*Effort: Medium.*

## 2.4 Crisis workflow completion

Enforce lifecycle transitions; make system audit entries immutable in the UI as well as the server; add an operational-period object (period boundaries, objectives, per-period staffing snapshot) that the ICS chart, checklists and AAR can reference; implement the Resource Tracker (resources requested, assigned, released) and the Comms Log (contacts, channels, notifications sent, with timestamps); share the personnel pool across incidents as a directory. Add the incident version number and conflict handling from the bug report's Tier 2 so blob edits stop racing.

*Effort: Medium–Large.*

## 2.5 Document engine

A server-side Chromium render route (the implementation plan's chunk 6, still unbuilt) with a light print theme, page furniture and static map rasters. First consumers: the after-action report, the property risk report and the incident archive, with reports persisted to storage and linked from the incident. Add structured exports (JSON/CSV) for the action log, checklist history, access log and AAR corrective actions.

*Effort: Medium. Parallel-safe; no dependency on 2.1–2.4.*

## 2.6 Multi-hazard risk report

Extend the risk report from wildfire to the hazards already sketched in the hazard-input matrix: flood (NWPS gauges, WPC QPF, flood alerts), severe weather (convective warnings; add SPC outlooks), winter, seismic (USGS magnitude/distance; add ShakeMap) and utility (outage feeds). Add the missing wildfire inputs the report itself lists: relative humidity/fuel moisture and terrain slope from a DEM. Fix the property-local "today" and the truncation labelling from the bug report.

*Effort: Medium per hazard. Dependency: 2.5 for PDF output; 3.1 for RH/fuel-moisture fields.*

## 2.7 Reliable movement tracking

Persist the ship tracker to Postgres like flights and lightning; budget a paid by-IMO AIS provider and treat the CruiseMapper scrape as a last-resort fallback; add heartbeat and back-off to the AIS and ADS-B paths; add a server cache for the hurricane feeds so share pages stop fanning out to Esri; refresh satellite TLEs on a timer while the layer is on.

*Effort: Small–Medium.*

## 2.8 Scale-out infrastructure

Introduce Redis for the TTL cache, the rate limiter and SSE pub/sub; move the intel buffer and geocode cache into it; make collectors leader-elected or move them to a worker dyno. Add ETag/conditional requests to the large upstream pulls (NWS alerts, USGS, NWPS). Target: two web dynos plus one worker, zero-downtime deploys, no cold-start "warming up" responses.

*Effort: Medium. Dependency: none, but do it before 2.2 puts more work on the server.*

**V2 summary.** Seven workstreams, three of which (2.1, 2.2, 2.8) are load-bearing for everything after. Sequence: 2.1 and 2.8 first, 2.3 and 2.5 in parallel, then 2.2, 2.4, 2.6 and 2.7. Effort: roughly two to three quarters for a small team.

# V3 — Intelligence and Analytical Depth

**Goal.** Deepen the analysis so the product reasons about hazards and intelligence rather than only displaying them, and extend coverage to the whole footprint including international assets and the fleet at sea.

## 3.1 Environmental fields pipeline

Replace the 5-degree Open-Meteo wind grid with a real gridded-field pipeline: ingest GFS/HRRR GRIB2 on the worker, publish tiled fields for wind, pressure (isobars), temperature, relative humidity, fuel moisture and precipitation, with time stepping. This is the implementation plan's Track 4 and the prerequisite the risk report and fire-behaviour work both name.

*Effort: Large.*

## 3.2 Live fire behaviour

Rothermel-based spread rate and flame length per drawn zone using LANDFIRE fuels, DEM slope and live wind/humidity from 3.1, with a conditions selector (current, forecast peak, worst case) — the implementation plan's chunk 8b. Evaluate a JavaScript port of BehavePlus before hand-writing equations.

*Effort: Medium. Dependency: 3.1.*

## 3.3 Intelligence processing and analyst workflow

Replace keyword regexes with an NLP/LLM pipeline: entity and location extraction, per-asset relevance ranking, cross-source story clustering and true deduplication, summarisation, and translation. Add sources the GSOC audience expects (X/Twitter where licensable, Telegram, Reddit, local broadcast and newspaper feeds, GDACS and ReliefWeb for international emergencies), per-source refresh intervals and conditional fetching, and a persistent intel store with search, history and replay. Add analyst workflow: triage queue, tagging, case files linked to incidents, and a daily intelligence summary. Move the intel and GDELT pin layers back onto the operator globe.

*Effort: Large. Dependency: 2.2 (alert engine) and 2.8 (Redis/worker).*

## 3.4 Historical analytics

Threat-score timelines and property "weather" over time; cross-incident metrics computed from the audit log and access logs (time-to-active, command transfers, checklist completion, stakeholder reach) with trend views; a corrective-action tracker with owners and due dates across AARs; feed replay/time-scrub for alerts, hotspots and smoke so an AAR can show what the picture looked like at each decision point.

*Effort: Medium. Dependency: 2.2 (score history), 2.4 (operational periods), 2.5 (report engine).*

## 3.5 Site asset and infrastructure layer

Buildings, generators, water systems, communications and access points per property with compliance fields (last inspected, next due, condition, responsible party) — the implementation plan's Track 2 — with a viewer-exposure policy so share links can show or withhold asset detail. Cross-reference outages with generator runtime and fuel. Start the data collection early; it is the long pole.

*Effort: Medium code, long organisational lead time. Dependency: 2.1, 2.3.*

## 3.6 International and maritime coverage

Global alert feeds (MeteoAlarm for Europe, GDACS, Copernicus EMS activations, national tsunami warning centres), global air quality (OpenAQ), international fire (FIRMS is already global; add Copernicus EFFIS), port and maritime notices, piracy and security incident feeds for the fleet's routes, and marine weather (wave height, swell) along vessel tracks. Extend the risk report to run on international properties and on a vessel's position and route.

*Effort: Medium–Large.*

## 3.7 Mobile

A progressive web app with a manifest, service worker, offline shell and push notifications, and a mobile-first crisis view for responders on site (log actions, tick checklists, upload photos) — distinct from the stakeholder share page.

*Effort: Medium. Dependency: 2.2 for push.*

**V3 summary.** Roughly three to four quarters. 3.1 and 3.3 are the big investments; 3.4 is cheap once V2 has captured the data; 3.5 should be started on paper during V2.

# V4 — Platform

**Goal.** Operate the product for many customers and plug it into the rest of the security stack.

- **Multi-tenant SaaS.** Tenant isolation across the asset register, incidents, share links, watchlist and intel; per-tenant feature flags and data-source keys; tenant-level usage and cost reporting (the paid feeds and model calls).
- **Enterprise identity.** SAML/OIDC single sign-on, SCIM provisioning, fine-grained roles (viewer, operator, incident commander, admin), and a full audit trail for administrative actions.
- **Integrations.** Outbound to mass-notification platforms (Everbridge, AlertMedia), ticketing/ITSM, and chat; inbound from access-control, CCTV analytics and travel-management systems; a documented public API and webhooks; a layer SDK so customers can add their own feeds.
- **AI copilot for incident command.** Drafting situation reports and stakeholder updates from the log, suggesting checklist items by incident type and phase, summarising the last operational period, and answering "what changed in the last hour" — grounded in the incident record and the feeds, with every suggestion attributable.
- **Predictive risk.** Calibrate the threat score against outcomes captured in V2/V3 history; forecast exposure from NWS outlooks, fire-potential forecasts and storm tracks so the dashboard shows tomorrow's risk, not only today's.
- **Deployment options.** Containerised deployment for customers who need on-premises or private-cloud hosting; region pinning for data residency.

**Effort.** A year or more; V4 is a direction, not a plan, and should be re-scoped after V2 ships.

# Sequencing Rationale

1. **Security before features.** V1 closes the findings that would fail a customer's review; nothing else matters until then.
2. **Data model before automation.** The asset register (2.1) is read by monitoring, alerting, the risk report and the asset layer; building alerting on hardcoded arrays would have to be redone.
3. **Capture before analysis.** Score history, operational periods and structured audit data (V2) are what V3's analytics consume. They cannot be back-filled, so they ship early even though their payoff is later.
4. **Infrastructure before load.** Redis and a worker dyno (2.8) come before server-side monitoring and NLP put continuous load on the server.
5. **Reports through one engine.** The PDF engine (2.5) lands before the multi-hazard report and the AAR revamp so both render through the same path — the earlier implementation plan's sequencing still holds.
6. **International coverage follows the customer footprint.** The fleet is the international asset today; 3.6 is scoped to the routes that matter first.

# Effort Overview

| Version | Theme | Relative effort | Key outputs |
|---|---|---|---|
| V1 | Trusted operating picture | ~2 weeks | Security gate closed, documented deployment, dead code removed, route tests in CI |
| V2 | Configurable and proactive | 2–3 quarters | Asset register and admin, server-side alerting with notifications, identity hardening, crisis workflow completion, PDF engine, multi-hazard risk report, dependable tracking, Redis/worker scale-out |
| V3 | Intelligence and depth | 3–4 quarters | Gridded environmental fields, live fire behaviour, NLP intel with analyst workflow, historical analytics, site asset layer, international/maritime coverage, PWA |
| V4 | Platform | 1 year+ | Multi-tenant SaaS, SSO/RBAC, integrations and API, AI copilot, predictive risk, deployment options |

# Decisions That Gate the Roadmap

| Decision | Blocks | Recommendation |
|---|---|---|
| Vessel-position budget: paid AIS provider or accept intermittent free coverage | V1 caveat, 2.7 | Budget the provider; the fleet is a headline asset |
| Alert delivery channels the customer will actually use | 2.2 | Email plus one chat webhook first; SMS via a provider once volumes are known |
| Who owns per-type checklist and intake content | 2.1, 2.4 | The customer's emergency-management lead, through the admin editor |
| Server-side PDF (recommended) vs. print-CSS only | 2.5, 2.6 | Server-side Chromium; print CSS cannot produce consistent documents |
| Are asset locations and infrastructure exposed on share links | 3.5, 2.3 | Gated by a per-link audience; withheld by default |
| Intel sources with licensing exposure (PulsePoint, CruiseMapper, Blitzortung relays) | 3.3, 2.7 | Keep as best-effort, label as such, and pursue licensed alternatives in V3 |
| Second tenant timing | 2.1, V4 | Add the tenant column in V2 regardless; multi-tenant operations wait for V4 |
