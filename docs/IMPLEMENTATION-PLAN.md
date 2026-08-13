# GSOC Monitor — Implementation Plan

Phased implementation of the roadmap (incident-command foundations, risk reporting,
fire behavior, environmental visualization, asset layer). Organized as small,
independently shippable and testable chunks — one branch/PR per chunk — sequenced so
each builds on the last and nothing lands as one giant unreviewable branch.

Source roadmap: "GSOC Monitor — Roadmap Notes & Prompt Library" (external notes).
This plan reconciles that roadmap against the actual codebase as of Aug 2026.

---

## What the code reality-check changed about the roadmap

Findings from a full audit of the crisis subsystem, wind/fuel pipelines, and export
paths. These reshape several roadmap items:

1. **V1 wind particles already shipped.** `WindLayer.tsx` renders 7,000 CPU-advected
   particles (plus a separate streamlines layer) over a 5° Open-Meteo-batched grid.
   Track 4 shrinks to isobars/RH/temp — but the grid is wind-only and 5° resolution,
   too coarse for isobars. The real Track 4 work is a multi-field grid pipeline.
2. **S1 is a bug fix, not a feature.** `TitleBadge.tsx` already counts active
   incidents in the tab title, but doesn't exclude archived incidents — a stood-down
   incident whose status was never flipped keeps the ⚠ CRISIS badge forever. Exactly
   the state-model conflation F2 predicts.
3. **S4 is tiny.** Sidebar sections already collapse (`Section.tsx`); state just
   isn't persisted. The zustand `persist` pattern exists in four other stores.
4. **The sync model is a landmine under W3.** Incident sync (`IncidentSync.tsx`) is
   whole-document last-write-wins JSONB replace with a 1.5 s debounce. An audit log
   riding inside that blob will silently drop entries when two operators write.
   W3's log entries must be **server-side append-only**, not part of the blob.
5. **Share links are stronger than the roadmap assumed, with three concrete holes.**
   Revocation *is* checked on every request; tokens are 122-bit CSPRNG; passwords
   double-hashed. But: no TTL exists anywhere; legacy passwordless links are open to
   anyone with the URL; deleting an incident leaves its share links live and serving
   the last snapshot; the plaintext link password is stored inside the incident
   JSONB. No access logging at all.
6. **A1's swimlane is partially back-fillable today.** `PersonnelAssignment` already
   carries `startedAt`/`endedAt`, so command-transfer history exists in the data —
   the current AAR just drops every ended assignment. Role create/delete and
   complexity changes leave no trace, though; those need W3.
7. **There is no PDF engine anywhere in the app.** The only print path is
   `window.print()` over a dark theme with zero page-break control
   (`CrisisReportModal.tsx`). Track 7 is greenfield.
8. **Incident types today** are a bare string union with two *divergent* label maps
   (`SituationReport.tsx` vs `IncidentList.tsx`), and the server accepts any JSON —
   no validation. Status→color styling is duplicated in five files.

---

## The chunks

Each chunk is one branch/PR. "Gate" = an open question that must be answered before
that chunk starts (see Decision gates below).

### Chunk 0 — CI safety net *(tiny, first)*
GitHub Actions running typecheck + build for both workspaces, Vitest wired into
client and server with first unit tests. There are currently zero tests and no CI,
and chunks 1–5 rewrite the crisis core; this keeps every later branch reviewable.

### Chunk 1 — F1 incident taxonomy + F2 state model
- Single `incidentTypes` module: `{ id, label, category, color, icon,
  defaultSeverity, sortOrder }` per type, expanded starting set (roadmap's list plus
  the existing types that don't cleanly map), replacing the string union and both
  divergent label maps. Everything downstream reads from it.
- New state model `monitoring → active → recovery → closed`, with a read-time
  normalizer for legacy stored values (`contained` → `recovery`,
  `resolved` → `closed`; `archivedAt` set forces `closed`).
- Consolidate the five duplicated status→color maps into one status-meta module.
- Server-side validation of `incidentType` / `incidentStatus` on POST/PUT
  (accepting legacy slugs).
- S1 falls out for free: tab badge counts `active` under the new model and excludes
  archived — fixing the stuck-badge bug.
- Tests: legacy-value normalization, taxonomy integrity.

### Chunk 2 — Small-changes batch (S2, S3, S4)
Color-by-type on map + incident cards with severity as an alternate mode toggle
(S2); incident-creation picker reading the taxonomy, grouped by category (S3 —
gate Q1); persisted sidebar collapse state via a persisted UI store (S4).

### Chunk 3 — W3 incident log *(the load-bearing branch)*
- Actor attribution on every entry (auth store exists; the log never reads it).
- System-generated events as first-class log entries: status transitions, ICS
  assignments/transfers/role changes, share-link create/revoke, operational-period
  boundaries, complexity-type changes — structured `kind` + payload so the AAR can
  render them later.
- Sync safety (finding 4): log appends go through a server-side append-only path so
  concurrent operators can't erase each other's entries. Gate Q3.
- Acceptance bar: a two-client concurrency test.

### Chunk 4 — F3 stand-down orchestration
Replaces today's one-line `archivedAt` write (no snapshot, no revocation, links keep
auto-publishing after stand-down). Transactional sequence with a checklist UI:
freeze snapshot (the share-publish path already builds one) → revoke links → close
open ICS assignments → stamp `closed_at` / `closed_by` / reason → log the event →
generate the AAR draft stub. Depends on chunks 1 and 3.

### Chunk 5 — W4 share-link lifecycle
Default TTL + `expires_at`, link rotation, access logging (who opened, when — the
AAR "who actually saw it" metric), and a stand-down page for revoked/expired viewers
instead of today's misleading "may have expired" error. Closes the three security
holes from finding 5. Gates Q9 (grace window) and Q10 (asset exposure — must land
before Track 2 ever ships). Frozen-snapshot grace window rides on chunk 4's snapshot.

### Chunk 6 — Track 7 PDF engine *(parallel-safe)*
Server-side render path: one Puppeteer/headless-Chromium route (Heroku Chromium
buildpack), light print theme, page furniture (incident name/ID, page X of Y,
timestamp, brand block), static map raster in place of live canvas. First consumer:
port the existing AAR modal to it with content unchanged — fixes the unreadable
print preview without waiting for Track 6. Gate Q12 (recommendation: server-side).
Independent of chunks 3–5.

### Chunks 7a/7b — Track 3 property risk report ⭐
- 7a: the hazard-input matrix as a committed design doc; fixed analysis rings
  (site / 1 mi / 5 mi / 25 mi / 100 mi — the proximity scanner already computes
  25/50/100 mi, so extend it); preset layer bundles per hazard; wildfire report
  end-to-end as an in-app view. Existing scaffolding: `proximityScan.ts`,
  `reportCanvas.ts`.
- 7b: PDF export via chunk 6, share link reusing the crisis share pattern, second
  hazard. Gate Q6 (advisory vs decision-driving rating).

### Chunks 8a/8b — R2 fuel behavior on the LANDFIRE breakdown
- 8a *(independent, small)*: reference tier — extend `fbfm40.ts` with published
  nominal spread rate / flame length per model (today it has only name/group/color;
  the zonal score tables are unitless 0–100), tap-to-pin card UI (hover is
  desktop-only affordance), suppression-interpretation bands.
- 8b: live tier — Rothermel against current wind (existing point-forecast route),
  terrain slope, and a fuel-moisture source (gate Q8); evaluate the behave JS port
  before hand-writing equations; conditions selector (current / forecast peak /
  worst case).

### Chunk 9 — Track 6 AAR revamp
Deliberately late — needs W3 capturing real incidents first. A1 ICS-progression
swimlane (prototype early against existing assignment history, finding 6) +
complexity band; A2 four-question structure with response metrics computed from the
W3 log and W4 access logs; corrective-action tracker with its own schema; cross-
incident metrics once several AARs share it (gate Q13 on back-filling the four
existing AARs). Renders through chunk 6.

### Chunk 10 — W1 viewer mode + M1 mobile
Redesign `CrisisShareView` around the 30-second stakeholder question: affected-
properties summary on top, W3 timeline, "last updated" indicator, mobile-first
viewer layout (most shared-link viewers are on phones). Informed by the Prompt 1A
strategy output.

### Chunk 11 — Track 2 site asset & infrastructure layer
DB-backed Building + Asset entities keyed to property (today: a hardcoded 31-entry
point array with 16 consumer modules), with compliance fields (`last_inspected`,
`next_due`, `condition`, `responsible_party`) from day one. Gated on population
strategy (Q2) and viewer-exposure policy (Q10 → chunk 5's named-link permissions).
**Start property data collection now, in parallel, via paper/CSV — it's the
months-long part.**

### Chunk 12 — Track 4 environmental visualization
V2 isobars → V3 RH / V4 temp (V1 particles already exist). Design decision first:
densify the Open-Meteo batching pattern regionally vs. real GRIB parsing — the
current 5° grid won't contour acceptably. The wind route (background refresh +
`snapshots` table + baked fallback) is the template for each new gridded field.

---

## Decision gates

| Gate | Question | Blocks |
|---|---|---|
| Q1 | S3 "pull from a list of ___" — types, properties, or templates? | Chunk 2 |
| Q3 | Who edits during an incident — one operator or several? | Chunk 3 |
| Q9 | Revoked links: hard cut vs frozen snapshot for 24–48 h | Chunk 5 |
| Q10 | Are asset locations exposed on shared links, or gated? | Chunks 5, 11 |
| Q12 | PDF path: server-side Chromium (recommended) vs print CSS | Chunk 6 |
| Q6 | Risk rating: advisory or drives documented decision thresholds? | Chunk 7 |
| Q8 | Fire-behavior conditions source: RAWS, gridded, or operator-entered | Chunk 8b |
| Q2 | Who populates asset data per property, and what keeps it current? | Chunk 11 |
| Q13 | Back-fill the four existing AARs into the new schema? | Chunk 9 |

The three Part-1 strategy prompts (war-room vision, analysis layer, Windstar value
case) run independently in parallel and feed chunks 10, 7, and future maritime work.
They block nothing early.

## Sequence rationale

Taxonomy + state model first because six other items read from them and the current
code demonstrably conflates states (finding 2). The incident log (chunk 3) is the
single most load-bearing item: stand-down orchestration, the AAR revamp, the ICS
progression graphic, and every response-time metric read from it — and it cannot be
retrofitted, because data never captured is unrecoverable. The PDF engine lands
before the risk report and AAR revamp so both render through one path. The AAR
revamp waits until the log has captured a few real activations. The asset layer sits
late not because it's low-value but because its bottleneck is organizational data
collection, which should start immediately on paper while the code catches up.
