import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { INCIDENT_TYPES } from '../crisis/taxonomy';
import { GENERAL_SCOPE, sameScope, scopeRank, type TemplateScope } from '../crisis/templates/model';
import { propertyDef, scopeLabel, scopePropertyLabel, scopeTypeLabel, TEMPLATE_PROPERTIES } from '../crisis/templates/scopeLabels';
import { useAdminPageStore } from './adminPageStore';
import { ScopePicker } from './ScopePicker';

// ── IAP library ───────────────────────────────────────────────────────────────
// Which Incident Action Plan PDF an incident gets — on its IAP tab and on its
// share links. Documents are scoped like the checklist templates, by incident
// type AND property, one document per scope, and an incident gets the most
// specific one that applies:
//
//   Type + property  →  Type  →  Property  →  General default
//
// (server/src/routes/iap.ts, findIapForScope). This page is the intended way
// to change the mapping — upload with a scope selected to give that scope its
// own IAP; uploading to a scope that already has one replaces it.

export interface IapDoc {
  id: string;
  name: string;
  incident_type: string | null;
  /** Absent from servers older than property-scoped IAPs — treat as null. */
  location_group_id?: string | null;
  size: number;
  updated_at: string;
}

export type IapMatch = 'type+property' | 'type' | 'property' | 'general';

/** Matches the server's cap (MAX_PDF_BYTES in routes/iap.ts). */
export const MAX_IAP_BYTES = 15 * 1024 * 1024;

const isNullableString = (v: unknown) => v === null || typeof v === 'string';

export function isIapDoc(v: unknown): v is IapDoc {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return typeof d.id === 'string' && typeof d.name === 'string' &&
    isNullableString(d.incident_type) &&
    (d.location_group_id === undefined || isNullableString(d.location_group_id)) &&
    typeof d.size === 'number' && typeof d.updated_at === 'string';
}

export function iapDocScope(d: Pick<IapDoc, 'incident_type' | 'location_group_id'>): TemplateScope {
  return { incidentType: d.incident_type ?? null, propertyId: d.location_group_id ?? null };
}

/** The match kind a document answers with is simply its own scope's kind. */
export function iapMatchForScope(s: TemplateScope): IapMatch {
  return (['general', 'type', 'property', 'type+property'] as const)[scopeRank(s)];
}

export const IAP_MATCH_LABEL: Record<IapMatch, string> = {
  'type+property': 'matched on incident type and property',
  type: 'matched on incident type',
  property: 'matched on property',
  general: 'general default',
};

/** "General default (all incidents)" for the unscoped row, else the scope's name. */
export function iapScopeLabel(s: TemplateScope): string {
  return scopeRank(s) === 0 ? 'General default (all incidents)' : scopeLabel(s);
}

/** Who a document in this scope serves, given that more specific plans win. */
export function iapAudience(s: TemplateScope): string {
  switch (scopeRank(s)) {
    case 0: return 'Serves every incident that has no more specific plan.';
    case 1: return `Serves every ${scopeTypeLabel(s.incidentType!, false)} incident, unless its property has a ${scopeTypeLabel(s.incidentType!, false)} plan of its own.`;
    case 2: return `Serves incidents at ${scopePropertyLabel(s.propertyId!, false)} whose type has no plan of its own.`;
    default: return `Serves only ${scopeTypeLabel(s.incidentType!, false)} incidents at ${scopePropertyLabel(s.propertyId!, false)}.`;
  }
}

const TYPE_ORDER = new Map<string, number>(INCIDENT_TYPES.map((t, i) => [t.id, i]));
const PROPERTY_ORDER = new Map<string, number>(TEMPLATE_PROPERTIES.map((p, i) => [p.id, i]));
// Unknown ids (a type or property this build no longer lists) sort last, by id.
const orderOf = (order: Map<string, number>, id: string | null) => (id === null ? -1 : order.get(id) ?? order.size);

/** Resolution-rank order, then taxonomy order for types and list order for properties. */
export function compareIapScopes(a: TemplateScope, b: TemplateScope): number {
  return scopeRank(a) - scopeRank(b) ||
    orderOf(TYPE_ORDER, a.incidentType) - orderOf(TYPE_ORDER, b.incidentType) ||
    (a.incidentType ?? '').localeCompare(b.incidentType ?? '') ||
    orderOf(PROPERTY_ORDER, a.propertyId) - orderOf(PROPERTY_ORDER, b.propertyId) ||
    (a.propertyId ?? '').localeCompare(b.propertyId ?? '');
}

export interface IapDocGroup {
  rank: 0 | 1 | 2 | 3;
  title: string;
  docs: IapDoc[];
}

const GROUP_TITLES = ['General default', 'By incident type', 'By property', 'Incident type + property'] as const;

/**
 * The library listing: General default first (always present, possibly empty
 * — its absence is worth seeing), then type, property and type + property
 * groups when they have documents.
 */
export function groupIapDocs(docs: readonly IapDoc[]): IapDocGroup[] {
  const sorted = [...docs].sort((a, b) =>
    compareIapScopes(iapDocScope(a), iapDocScope(b)) || a.name.localeCompare(b.name));
  return ([0, 1, 2, 3] as const)
    .map((rank) => ({ rank, title: GROUP_TITLES[rank], docs: sorted.filter((d) => scopeRank(iapDocScope(d)) === rank) }))
    .filter((g) => g.rank === 0 || g.docs.length > 0);
}

export function findIapDocForScope(docs: readonly IapDoc[], s: TemplateScope): IapDoc | undefined {
  return docs.find((d) => sameScope(iapDocScope(d), s));
}

/** A scope handed over from an incident, minus anything the pickers can't show. */
export function knownIapScope(s: TemplateScope | null | undefined): TemplateScope {
  if (!s) return GENERAL_SCOPE;
  return {
    incidentType: s.incidentType && TYPE_ORDER.has(s.incidentType) ? s.incidentType : null,
    propertyId: s.propertyId && propertyDef(s.propertyId) ? s.propertyId : null,
  };
}

/** GET /api/iap/resolve for an incident of this type at this property (null = none). */
export function iapResolveUrl(s: TemplateScope): string {
  const p = new URLSearchParams();
  if (s.incidentType) p.set('type', s.incidentType);
  if (s.propertyId) p.set('property', s.propertyId);
  const qs = p.toString();
  return `/api/iap/resolve${qs ? `?${qs}` : ''}`;
}

/** Validates the resolve answer; a missing/unknown match is derived from the document's scope. */
export function parseIapResolve(v: unknown): { doc: IapDoc | null; match: IapMatch | null } | null {
  if (!v || typeof v !== 'object') return null;
  const { doc, match } = v as { doc?: unknown; match?: unknown };
  if (doc === null || doc === undefined) return { doc: null, match: null };
  if (!isIapDoc(doc)) return null;
  const known = typeof match === 'string' && Object.prototype.hasOwnProperty.call(IAP_MATCH_LABEL, match);
  return { doc, match: known ? (match as IapMatch) : iapMatchForScope(iapDocScope(doc)) };
}

/** Why this file can't be uploaded, or null. Same checks the server makes, minus the %PDF- magic. */
export function iapFileProblem(f: { name: string; type: string; size: number }): string | null {
  if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return 'Choose a PDF file.';
  if (f.size === 0) return 'That file is empty.';
  if (f.size > MAX_IAP_BYTES) return 'PDF is larger than 15 MB.';
  return null;
}

/** Default display name: the file name without `.pdf`, capped like the server (120). */
export function iapNameFromFile(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').trim().slice(0, 120);
}

export const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
};

const readAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });

const errorFrom = async (res: Response): Promise<string> => {
  const body = await res.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === 'string' && body.error ? body.error : `HTTP ${res.status}`;
};

const cardCls = 'rounded-lg border border-white/8 bg-white/3 p-3 md:p-4';
const h3Cls = 'text-[10px] font-bold uppercase tracking-wider text-white/35';
const smallBtn =
  'shrink-0 rounded px-1.5 py-1 text-[10px] transition disabled:opacity-40';

// ── Resolver preview ──────────────────────────────────────────────────────────

interface ResolveState {
  loading: boolean;
  error: string | null;
  doc: IapDoc | null;
  match: IapMatch | null;
}

function ResolverPreview({
  initialScope, version, onResolved, onUploadFor,
}: {
  initialScope: TemplateScope;
  /** Bumped after every library change, so the answer never goes stale. */
  version: number;
  onResolved: (docId: string | null) => void;
  onUploadFor: (s: TemplateScope) => void;
}) {
  const [scope, setScope] = useState(initialScope);
  const [res, setRes] = useState<ResolveState>({ loading: true, error: null, doc: null, match: null });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    // Keep the previous answer on screen (dimmed) while the next one loads.
    setRes((r) => ({ ...r, loading: true, error: null }));
    fetch(iapResolveUrl(scope), { credentials: 'include', signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: unknown) => {
        const parsed = parseIapResolve(body);
        if (!parsed) throw new Error('unexpected response');
        setRes({ loading: false, error: null, ...parsed });
        onResolved(parsed.doc?.id ?? null);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        console.error('[admin] IAP resolve failed', e);
        setRes({ loading: false, error: 'Could not check which plan applies.', doc: null, match: null });
        onResolved(null);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.incidentType, scope.propertyId, version, retry, onResolved]);

  // The answer is the scope's own document: nothing more specific to offer.
  const own = !!res.doc && sameScope(iapDocScope(res.doc), scope);

  return (
    <section aria-labelledby="iap-resolver-h" className={cardCls}>
      <h3 id="iap-resolver-h" className={h3Cls}>Which plan will an incident get?</h3>
      <p className="mb-2.5 mt-1 text-[11px] text-white/40">
        Pick an incident’s type and property. Leaving a field on “All …” previews an incident with no
        type or no property set.
      </p>
      <ScopePicker value={scope} onChange={setScope} typeLabel="Incident type" propertyLabel="Property" />

      <div aria-live="polite" className={`mt-3 transition-opacity ${res.loading ? 'opacity-50' : ''}`}>
        {res.error ? (
          <div className="flex items-center gap-3 rounded border border-red-400/25 bg-red-400/8 px-3 py-2">
            <p className="flex-1 text-[11px] text-red-300/85">{res.error}</p>
            <button onClick={() => setRetry((n) => n + 1)}
              className="rounded border border-white/15 px-2.5 py-1 text-[10px] text-white/60 transition hover:border-white/30 hover:text-white">
              Retry
            </button>
          </div>
        ) : res.doc ? (
          <div className="rounded border border-accent/25 bg-accent/6 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-white/85">{res.doc.name}</p>
              <a href={`/api/iap/${res.doc.id}/file`} target="_blank" rel="noreferrer"
                className="shrink-0 text-[10px] text-accent/80 transition hover:text-accent">
                View ↗
              </a>
            </div>
            <p className="mt-0.5 text-[10px] text-white/45">
              From <span className="text-white/70">{iapScopeLabel(iapDocScope(res.doc))}</span>
              {res.match && <> — {IAP_MATCH_LABEL[res.match]}</>}
            </p>
            {!own && (
              <button onClick={() => onUploadFor(scope)}
                className="mt-2 text-[10px] text-white/45 underline-offset-2 transition hover:text-white/80 hover:underline">
                Give {scopeLabel(scope)} its own plan…
              </button>
            )}
          </div>
        ) : res.loading ? (
          <p className="text-[11px] text-white/35">Checking…</p>
        ) : (
          <div className="rounded border border-amber-400/25 bg-amber-400/8 px-3 py-2.5">
            <p className="text-[11px] text-amber-200/80">
              No plan applies — this incident’s IAP tab and share links will have no action plan.
            </p>
            <button onClick={() => onUploadFor(scope)}
              className="mt-1.5 text-[10px] text-white/50 underline-offset-2 transition hover:text-white/80 hover:underline">
              Upload a plan for {iapScopeLabel(scope)}…
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

export function IapSection() {
  // Opened from an incident's IAP tab: start both pickers on its scope.
  const [initialScope] = useState(() => knownIapScope(useAdminPageStore.getState().scope));

  const [docs, setDocs] = useState<IapDoc[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [matchedId, setMatchedId] = useState<string | null>(null);
  const loadSeq = useRef(0);

  // Upload form
  const [uploadScope, setUploadScope] = useState(initialScope);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLElement>(null);

  // Status-checked, and only the latest request may land: a JSON error body
  // must not reach setDocs, and a slow early answer must not overwrite a
  // fresher one after an upload.
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const r = await fetch('/api/iap', { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows: unknown = await r.json();
      if (!Array.isArray(rows)) throw new Error('unexpected response');
      if (seq !== loadSeq.current) return;
      setDocs(rows.filter(isIapDoc));
      setLoadError(null);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      console.error('[admin] IAP library load failed', e);
      setLoadError('Could not load the IAP library.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => groupIapDocs(docs ?? []), [docs]);
  const existing = docs ? findIapDocForScope(docs, uploadScope) : undefined;

  const clearFile = () => {
    setFile(null);
    setName('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const pickFile = (f: File | undefined) => {
    setUploadError(null);
    setNotice(null);
    if (!f) { clearFile(); return; }
    const problem = iapFileProblem(f);
    if (problem) {
      setUploadError(problem);
      clearFile();
      return;
    }
    setFile(f);
    setName(iapNameFromFile(f.name));
  };

  const focusUpload = (s: TemplateScope) => {
    if (busy) return;
    setUploadScope(s);
    setNotice(null);
    uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    fileRef.current?.focus({ preventScroll: true });
  };

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || busy) return;
    const displayName = name.trim().slice(0, 120);
    if (!displayName) { setUploadError('Give the document a name.'); return; }
    const scope = uploadScope;
    const label = iapScopeLabel(scope);
    const replacing = docs ? findIapDocForScope(docs, scope) : undefined;
    // The notice above the button already says so; replacing deletes the old
    // file for good, so it also gets an explicit yes.
    if (replacing && !window.confirm(
      `Replace “${replacing.name}” with “${displayName}” for ${label}?\n\nThe current document is deleted.`
    )) return;

    setBusy(true);
    setUploadError(null);
    setNotice(null);
    try {
      const dataBase64 = await readAsBase64(file);
      const res = await fetch('/api/iap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: displayName,
          incidentType: scope.incidentType,
          propertyId: scope.propertyId,
          dataBase64,
        }),
      });
      if (!res.ok) {
        const detail = await errorFrom(res);
        throw new Error(res.status === 413 && detail.startsWith('HTTP') ? 'The server rejected the file as too large.' : detail);
      }
      setNotice(`Uploaded “${displayName}” for ${label}.`);
      clearFile();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
      // Refresh either way: a failed replace may still have landed server-side
      // before the response was lost.
      void load();
      setVersion((v) => v + 1);
    }
  };

  const handleRemove = async (d: IapDoc) => {
    const scope = iapDocScope(d);
    const consequence = scopeRank(scope) === 0
      ? 'Incidents with no more specific plan will have no IAP.'
      : 'Incidents it served fall back to the next most specific plan (see “Which plan will an incident get?”).';
    if (!window.confirm(`Remove the IAP for ${iapScopeLabel(scope)} (“${d.name}”)?\n\n${consequence}`)) return;
    setRemovingId(d.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/iap/${d.id}`, { method: 'DELETE', credentials: 'include' });
      // 404 = already gone (another admin removed or replaced it): the refresh below is still right.
      if (!res.ok && res.status !== 404) throw new Error(await errorFrom(res));
      setDocs((prev) => prev?.filter((x) => x.id !== d.id) ?? prev);
    } catch (e) {
      console.error('[admin] IAP delete failed', e);
      setActionError(`Could not remove “${d.name}”: ${e instanceof Error ? e.message : 'request failed'}`);
    } finally {
      setRemovingId(null);
      void load();
      setVersion((v) => v + 1);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-5 md:px-8 md:py-6">
      <div>
        <h2 className="text-[14px] font-semibold text-white/90">IAP documents</h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-white/40">
          Incident Action Plan PDFs shown on an incident’s IAP tab and its share links. An incident gets
          the most specific plan that applies: <span className="text-white/60">type + property</span> →{' '}
          <span className="text-white/60">type</span> → <span className="text-white/60">property</span> →{' '}
          <span className="text-white/60">general default</span>.
        </p>
      </div>

      <ResolverPreview
        initialScope={initialScope}
        version={version}
        onResolved={setMatchedId}
        onUploadFor={focusUpload}
      />

      {/* Library */}
      <section aria-labelledby="iap-library-h">
        <h3 id="iap-library-h" className={`${h3Cls} mb-2`}>
          Library{docs ? ` (${docs.length})` : ''}
        </h3>
        {actionError && (
          <p role="alert" className="mb-2 rounded border border-red-400/25 bg-red-400/8 px-3 py-2 text-[11px] text-red-300/85">
            {actionError}
          </p>
        )}
        {loadError && docs === null ? (
          <div className="flex items-center gap-3 rounded-lg border border-red-400/25 bg-red-400/8 px-3 py-2.5">
            <p className="flex-1 text-[11px] text-red-300/85">{loadError}</p>
            <button onClick={() => void load()}
              className="rounded border border-white/15 px-2.5 py-1 text-[10px] text-white/60 transition hover:border-white/30 hover:text-white">
              Retry
            </button>
          </div>
        ) : docs === null ? (
          <p className="text-[11px] text-white/35" role="status">Loading documents…</p>
        ) : (
          <div className="space-y-3">
            {loadError && <p className="text-[10px] text-red-400/80">{loadError} Showing the last list loaded.</p>}
            {groups.map((g) => (
              <div key={g.rank}>
                <h4 className="mb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white/30">{g.title}</h4>
                <ul className="divide-y divide-white/6 rounded-lg border border-white/8">
                  {g.docs.length === 0 && (
                    <li className="px-3 py-2.5 text-[11px] italic text-white/30">
                      No general default — incidents without a more specific plan get none.
                    </li>
                  )}
                  {g.docs.map((d) => {
                    const scope = iapDocScope(d);
                    const matched = d.id === matchedId;
                    return (
                      <li key={d.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 ${matched ? 'bg-accent/6' : ''}`}>
                        <div className="min-w-0 flex-1 basis-48">
                          <p className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium text-white/80">
                            {iapScopeLabel(scope)}
                            {matched && (
                              <span className="rounded bg-accent/15 px-1 text-[8px] font-bold uppercase tracking-wider text-accent/80"
                                title="The plan the preview above resolves to">
                                preview match
                              </span>
                            )}
                          </p>
                          <p className="truncate text-[10px] text-white/35">
                            {d.name} · {fmtSize(d.size)} · {fmtDate(d.updated_at)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <a href={`/api/iap/${d.id}/file`} target="_blank" rel="noreferrer"
                            className={`${smallBtn} text-white/40 hover:text-white/75`}
                            aria-label={`View ${d.name} (opens in a new tab)`}>
                            View
                          </a>
                          <button onClick={() => focusUpload(scope)} disabled={busy}
                            className={`${smallBtn} text-white/40 hover:text-accent/85`}
                            aria-label={`Replace the plan for ${iapScopeLabel(scope)}`}>
                            Replace
                          </button>
                          <button onClick={() => handleRemove(d)} disabled={removingId === d.id}
                            className={`${smallBtn} text-white/30 hover:text-red-400/80`}
                            aria-label={`Remove the plan for ${iapScopeLabel(scope)}`}>
                            {removingId === d.id ? '…' : 'Remove'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Upload / replace */}
      <section ref={uploadRef} aria-labelledby="iap-upload-h" className={cardCls}>
        <h3 id="iap-upload-h" className={h3Cls}>Upload or replace a plan</h3>
        <form onSubmit={handleUpload} className="mt-2.5 space-y-3">
          <div>
            <ScopePicker value={uploadScope} onChange={(s) => { setUploadScope(s); setNotice(null); }}
              typeLabel="Incident type" propertyLabel="Property" disabled={busy} />
            <p className="mt-1.5 text-[10px] text-white/40">{iapAudience(uploadScope)}</p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[10px] text-white/45">PDF file (max 15 MB)</span>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                disabled={busy}
                onChange={(e) => pickFile(e.target.files?.[0])}
                className="w-full text-[10px] text-white/45 file:mr-2 file:rounded file:border file:border-white/12 file:bg-white/6 file:px-2.5 file:py-1 file:text-[10px] file:text-white/60"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-white/45">Display name</span>
              <input
                type="text"
                value={name}
                maxLength={120}
                disabled={busy || !file}
                onChange={(e) => setName(e.target.value)}
                placeholder={file ? '' : 'Choose a file first'}
                className="w-full rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/85 placeholder-white/25 outline-none focus:border-accent/40 disabled:opacity-50"
              />
            </label>
          </div>

          {existing && (
            <p className="rounded border border-amber-400/25 bg-amber-400/8 px-2.5 py-1.5 text-[10px] text-amber-200/80">
              This replaces ‘{existing.name}’ ({fmtSize(existing.size)}, uploaded {fmtDate(existing.updated_at)}).
            </p>
          )}
          {uploadError && <p role="alert" className="text-[10px] text-red-400/85">{uploadError}</p>}
          {notice && <p role="status" className="text-[10px] text-accent-ok/85">✓ {notice}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={!file || !name.trim() || busy}
              className="rounded bg-accent/20 px-3 py-1.5 text-[11px] font-medium text-accent transition hover:bg-accent/30 disabled:opacity-40"
            >
              {busy ? 'Uploading…' : existing ? 'Replace document' : 'Upload'}
            </button>
            {file && !busy && (
              <button type="button" onClick={clearFile}
                className="rounded border border-white/10 px-3 py-1.5 text-[11px] text-white/45 transition hover:text-white/70">
                Clear
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
