import { useCallback, useEffect, useRef, useState } from 'react';
import { useActiveIncident } from '../crisisStore';
import { useAuthStore } from '../../auth/authStore';
import { useAdminPageStore } from '../../admin/adminPageStore';
import { PdfViewer } from '../PdfViewer';
import { incidentTypeDef } from '../taxonomy';
import { TEMPLATE_ID_RE } from '../templates/model';
import { scopeLabel, scopePropertyLabel, scopeTypeLabel } from '../templates/scopeLabels';
import { MissingPropertyHint, TemplatesLoadState } from '../templates/editorTabChrome';

// ── IAP tab (editor) ─────────────────────────────────────────────────────────
// The pre-uploaded Incident Action Plan for this incident: the most specific
// document on file for its type and property (type + property → type →
// property → general default; server/src/routes/iap.ts, findIapForScope).
// It is the same plan the incident's share links serve. Documents are managed
// on the admin page; the answer is re-checked when that page closes and when
// the browser tab comes back into view, so a replaced plan shows up without a
// reload. A replaced document gets a new id, so the reader's url changes with
// it and PdfViewer (which loads once per url) never shows a stale file.

export type IapMatch = 'type+property' | 'type' | 'property' | 'general';

export interface IapDocInfo {
  id: string;
  name: string;
  incident_type: string | null;
  location_group_id: string | null;
  size: number;
  updated_at: string;
}

export interface IapResolved {
  doc: IapDocInfo | null;
  match: IapMatch | null;
}

const MATCHES: readonly IapMatch[] = ['type+property', 'type', 'property', 'general'];

/**
 * GET /api/iap/resolve for this incident. The property is omitted when unset
 * — or malformed, which the server would reject outright (400) rather than
 * fall back to the type and general plans.
 */
export function iapResolvePath(typeId: string, propertyId: string | null | undefined): string {
  const p = new URLSearchParams({ type: typeId });
  if (propertyId && TEMPLATE_ID_RE.test(propertyId)) p.set('property', propertyId);
  return `/api/iap/resolve?${p.toString()}`;
}

const nullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** The rung a document sits on, from its own scope. */
export function iapMatchOf(doc: Pick<IapDocInfo, 'incident_type' | 'location_group_id'>): IapMatch {
  if (doc.incident_type && doc.location_group_id) return 'type+property';
  if (doc.incident_type) return 'type';
  if (doc.location_group_id) return 'property';
  return 'general';
}

/**
 * Shape-checks the resolve answer (null = unusable). An absent or unknown
 * `match` is derived from the document's scope; an absent location_group_id
 * (a server older than property-scoped plans) reads as "any property".
 */
export function parseIapResolveResponse(v: unknown): IapResolved | null {
  if (!v || typeof v !== 'object') return null;
  const { doc, match } = v as { doc?: unknown; match?: unknown };
  if (doc === null || doc === undefined) return { doc: null, match: null };
  if (typeof doc !== 'object') return null;
  const d = doc as Record<string, unknown>;
  if (
    typeof d.id !== 'string' || !d.id || typeof d.name !== 'string' ||
    !nullableString(d.incident_type) ||
    !(d.location_group_id === undefined || nullableString(d.location_group_id)) ||
    typeof d.size !== 'number' || typeof d.updated_at !== 'string'
  ) return null;
  const info: IapDocInfo = {
    id: d.id,
    name: d.name,
    incident_type: d.incident_type,
    location_group_id: d.location_group_id ?? null,
    size: d.size,
    updated_at: d.updated_at,
  };
  return { doc: info, match: MATCHES.includes(match as IapMatch) ? (match as IapMatch) : iapMatchOf(info) };
}

/** "Type-specific plan · 🔥 Wildfire", "General default", … — named from the document's own scope. */
export function iapMatchSummary(match: IapMatch, doc: Pick<IapDocInfo, 'incident_type' | 'location_group_id'>): string {
  const scope = { incidentType: doc.incident_type, propertyId: doc.location_group_id };
  switch (match) {
    case 'type+property': return `Type + property plan · ${scopeLabel(scope)}`;
    case 'type': return `Type-specific plan · ${scopeLabel(scope)}`;
    case 'property': return `Property plan · ${scopeLabel(scope)}`;
    default: return 'General default';
  }
}

/**
 * Why a less specific plan is showing, or null when the plan on screen is as
 * specific as this incident's type can get. A type plan outranks a property
 * plan, so only the property and general rungs mean "no plan for this type".
 */
export function iapFallbackNote(match: IapMatch, typeId: string, propertyId: string | null): string | null {
  const type = scopeTypeLabel(typeId);
  if (match === 'property') return `No ${type} plan is on file, so the property's plan applies.`;
  if (match === 'general') {
    return propertyId
      ? `No plan is on file for ${type} or ${scopePropertyLabel(propertyId)}, so the general default applies.`
      : `No ${type} plan is on file, so the general default applies.`;
  }
  return null;
}

/** "No Incident Action Plan uploaded for 🔥 Wildfire / 🏔 Grand Canyon". */
export function iapEmptyTitle(typeId: string, propertyId: string | null): string {
  const where = propertyId
    ? `${scopeTypeLabel(typeId)} / ${scopePropertyLabel(propertyId)}`
    : `${scopeTypeLabel(typeId)} incidents`;
  return `No Incident Action Plan uploaded for ${where}`;
}

export function fmtIapSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fmtUpdated(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `Updated ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

const iapFileUrl = (id: string) => `/api/iap/${encodeURIComponent(id)}/file`;

async function errorFrom(res: Response): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: unknown } | null;
  if (typeof body?.error === 'string' && body.error) return body.error;
  if (res.status === 401) return 'Your session has expired — sign in again.';
  return `The server answered ${res.status}.`;
}

// ── Header card for the document on screen ───────────────────────────────────

/** Store-free: name, which scope matched, size / date, and the new-tab link. */
export function IapDocSummary({ doc, match, fallbackNote }: {
  doc: IapDocInfo;
  match: IapMatch;
  fallbackNote: string | null;
}) {
  const meta = [fmtIapSize(doc.size), fmtUpdated(doc.updated_at)].filter(Boolean);
  const specific = match !== 'general';
  return (
    <div className="mb-3 rounded-lg border border-white/8 bg-white/4 px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-white/85" title={doc.name}>{doc.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-white/40">
            <span className={`rounded border px-1.5 py-px ${
              specific ? 'border-accent/25 bg-accent/8 text-accent/80' : 'border-white/12 bg-white/4 text-white/55'
            }`}>
              {iapMatchSummary(match, doc)}
            </span>
            {meta.map((m) => (
              <span key={m}><span aria-hidden className="mr-1.5 text-white/20">·</span>{m}</span>
            ))}
          </p>
        </div>
        <a
          href={iapFileUrl(doc.id)}
          target="_blank"
          rel="noreferrer"
          title={`Open ${doc.name} in a new browser tab`}
          className="shrink-0 rounded border border-white/12 px-2.5 py-1 text-[10px] text-white/55 transition hover:border-white/25 hover:text-white/80"
        >
          Open in new tab ↗
        </a>
      </div>
      {fallbackNote && <p className="mt-1.5 text-[10px] text-amber-200/65">{fallbackNote}</p>}
    </div>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────────

interface Loaded extends IapResolved {
  /** The resolve url this answer is for — an answer for another scope is never shown. */
  key: string;
}

export function IapTab() {
  const inc = useActiveIncident();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const adminOpen = useAdminPageStore((s) => s.open);
  // Normalized: a retired type id resolves like its successor does.
  const typeId = inc ? incidentTypeDef(inc.incidentType).id : null;
  const propertyId = inc?.locationGroupId ?? null;
  const url = typeId ? iapResolvePath(typeId, propertyId) : null;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  // Bumped to re-check the current scope without changing it.
  const [nonce, setNonce] = useState(0);
  const recheck = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!url) return;
    // Aborted on scope change / unmount, so a slow answer for the previous
    // type or property can never land on top of the current one.
    const ctrl = new AbortController();
    setPending(true);
    fetch(url, { credentials: 'include', cache: 'no-store', signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(await errorFrom(res));
        const parsed = parseIapResolveResponse(await res.json());
        if (!parsed) throw new Error('The server sent an unexpected answer.');
        if (ctrl.signal.aborted) return;
        setLoaded({ key: url, ...parsed });
        setFailure(null);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        console.warn('[iap] resolve failed:', e);
        setFailure({ key: url, message: e instanceof Error && e.message ? e.message : 'Network error.' });
      })
      .finally(() => { if (!ctrl.signal.aborted) setPending(false); });
    return () => ctrl.abort();
  }, [url, nonce]);

  // Re-check when the admin page closes (the admin may just have uploaded or
  // removed a plan) and when the browser tab returns to view.
  const wasAdminOpen = useRef(adminOpen);
  useEffect(() => {
    if (wasAdminOpen.current && !adminOpen) recheck();
    wasAdminOpen.current = adminOpen;
  }, [adminOpen, recheck]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') recheck(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [recheck]);

  if (!inc || !typeId || !url) return null;
  const frozen = !!inc.archivedAt;
  // Stale-while-revalidate within one scope; a different scope starts blank.
  const current = loaded?.key === url ? loaded : null;
  const error = failure?.key === url ? failure.message : null;
  const status = current ? 'ready' : error && !pending ? 'error' : 'loading';
  const reload = async () => recheck();
  const manage = () => useAdminPageStore.getState().openAdmin('iap', { incidentType: typeId, propertyId });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h3 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/65">Incident Action Plan</h3>
            <span className="text-[11px] text-white/40">
              The most specific plan on file for this incident's type and property — the same one its share links show
            </span>
          </div>
          {!propertyId && !frozen && <MissingPropertyHint what="plans" />}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {current && (
            <button
              onClick={recheck}
              disabled={pending}
              title="Check for a newer or more specific plan"
              className="rounded border border-white/10 px-2.5 py-1 text-[10px] text-white/40 transition hover:border-white/22 hover:text-white/70 disabled:cursor-wait disabled:opacity-50"
            >
              <span aria-hidden className={`mr-1 inline-block ${pending ? 'animate-spin' : ''}`}>↻</span>
              {pending ? 'Checking…' : 'Refresh'}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={manage}
              title="Open Admin → IAP documents for this incident's type and property"
              className="rounded border border-white/12 bg-white/4 px-2.5 py-1 text-[10px] text-white/55 transition hover:border-white/25 hover:text-white/80"
            >
              ✎ Manage IAP documents
            </button>
          )}
        </div>
      </div>

      <TemplatesLoadState what="Incident Action Plan" status={status} error={error} hasTemplate={!!current} reload={reload} />

      {current && (current.doc ? (
        <>
          <IapDocSummary
            doc={current.doc}
            match={current.match ?? iapMatchOf(current.doc)}
            fallbackNote={iapFallbackNote(current.match ?? iapMatchOf(current.doc), typeId, propertyId)}
          />
          {/* key: a different document starts at fit-width, page 1. A 404
              here means the plan was replaced or removed after the answer
              above — Refresh picks up whatever serves the incident now. */}
          <PdfViewer
            key={current.doc.id}
            url={iapFileUrl(current.doc.id)}
            emptyMessage="This plan was replaced or removed a moment ago — use Refresh above to load the current one."
          />
        </>
      ) : (
        <div className="rounded-lg border border-white/8 bg-white/4 px-5 py-8 text-center">
          <p className="text-[13px] text-white/60">{iapEmptyTitle(typeId, propertyId)}</p>
          <p className="mx-auto mt-1.5 max-w-md text-[11px] leading-snug text-white/35">
            Nothing is on file for this type{propertyId ? ', this property' : ''} or as a general default, so the
            incident's share links show no plan either.
            {!isAdmin && ' An admin can upload one under Admin → IAP documents.'}
          </p>
          {isAdmin && (
            <button
              onClick={manage}
              className="mt-3 rounded border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] text-accent/80 transition hover:border-accent/50 hover:text-accent"
            >
              Upload a plan…
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
