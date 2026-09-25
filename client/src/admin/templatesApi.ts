import {
  isCrisisTemplatesConfig, scopeKey,
  type ChecklistBlockItem, type ChecklistRoleMeta, type CrisisTemplatesConfig,
  type IntakeBlockGroup, type TemplateScope,
} from '../crisis/templates/model';
import { useTemplatesStore } from '../crisis/templates/templatesStore';

// ── Crisis templates admin API ───────────────────────────────────────────────
//
// Thin client for /api/crisis-templates (routes/crisisTemplates.ts). Nothing
// here throws: every call resolves to a result the editors can render, with a
// human-readable error (the server's own message when it sent one — it names
// the offending item). A write the server accepted, and a 409 that carries the
// current config, are adopted into the templates store right away so every
// open view is current; the editor keeps its draft either way and decides
// what to do with it.

export type TemplatesFetchResult =
  | { ok: true; config: CrisisTemplatesConfig }
  | { ok: false; status: number; error: string };

export type TemplatesSaveResult =
  | { ok: true; config: CrisisTemplatesConfig }
  | { ok: false; status: number; error: string; config?: CrisisTemplatesConfig };

const BASE = '/api/crisis-templates';

interface RawResponse {
  /** 0 = the request never got an answer (offline, DNS, CORS, aborted). */
  status: number;
  ok: boolean;
  body: unknown;
}

async function call(method: string, path: string, body?: unknown): Promise<RawResponse> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { status: 0, ok: false, body: null };
  }
  const parsed: unknown = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, body: parsed };
}

function describeError(status: number, body: unknown): string {
  const msg = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  if (typeof msg === 'string' && msg.trim()) return msg.trim();
  if (status === 0) return 'Could not reach the server — check your connection. Your changes are still here.';
  if (status === 401) return 'Your session has expired — sign in again (in another tab), then retry. Your changes are still here.';
  if (status === 403) return 'Only admins can change crisis templates.';
  if (status === 409) return 'Someone else saved this while you were editing.';
  if (status === 413) return 'That is too large to save.';
  if (status >= 500) return `The server could not complete the request (HTTP ${status}) — try again shortly.`;
  return `Request failed (HTTP ${status}).`;
}

function configIn(body: unknown): CrisisTemplatesConfig | null {
  const c = body && typeof body === 'object' ? (body as { config?: unknown }).config : undefined;
  return isCrisisTemplatesConfig(c) ? c : null;
}

async function read(path: string): Promise<TemplatesFetchResult> {
  const r = await call('GET', path);
  if (r.ok && isCrisisTemplatesConfig(r.body)) return { ok: true, config: r.body };
  return {
    ok: false,
    status: r.status,
    error: r.ok ? 'Unexpected response from the server.' : describeError(r.status, r.body),
  };
}

async function write(method: 'PUT' | 'DELETE', path: string, body?: unknown): Promise<TemplatesSaveResult> {
  const r = await call(method, path, body);
  const config = configIn(r.body);
  const store = useTemplatesStore.getState();
  if (r.ok) {
    if (config) {
      store.setConfig(config);
      return { ok: true, config };
    }
    // The write went through but the answer is unreadable: fetch the config
    // the normal way rather than report a failure that did not happen.
    await store.load();
    const fresh = useTemplatesStore.getState().config;
    if (fresh) return { ok: true, config: fresh };
    return { ok: false, status: r.status, error: 'Saved, but the updated templates could not be loaded — reload the page.' };
  }
  if (r.status === 409 && config) store.setConfig(config);
  return { ok: false, status: r.status, error: describeError(r.status, r.body), ...(config ? { config } : {}) };
}

/** The effective config (what incidents resolve against). */
export function fetchTemplates(): Promise<TemplatesFetchResult> {
  return read('');
}

/** The built-in defaults alone (every block `custom: false`). Admin only. */
export function fetchDefaultTemplates(): Promise<TemplatesFetchResult> {
  return read('/defaults');
}

const scopeQuery = (scope: TemplateScope) => `?scope=${encodeURIComponent(scopeKey(scope))}`;

export function saveChecklistBlock(
  scope: TemplateScope, items: ChecklistBlockItem[], baseRevision: number
): Promise<TemplatesSaveResult> {
  return write('PUT', '/checklist-blocks', { scope, items, baseRevision });
}

/** Delete the override: the scope goes back to its built-in default (or away, if it has none). */
export function resetChecklistBlock(scope: TemplateScope): Promise<TemplatesSaveResult> {
  return write('DELETE', `/checklist-blocks${scopeQuery(scope)}`);
}

export function saveIntakeBlock(
  scope: TemplateScope, groups: IntakeBlockGroup[], baseRevision: number
): Promise<TemplatesSaveResult> {
  return write('PUT', '/intake-blocks', { scope, groups, baseRevision });
}

export function resetIntakeBlock(scope: TemplateScope): Promise<TemplatesSaveResult> {
  return write('DELETE', `/intake-blocks${scopeQuery(scope)}`);
}

export function saveChecklistRoles(roles: ChecklistRoleMeta[], baseRevision: number): Promise<TemplatesSaveResult> {
  return write('PUT', '/checklist-roles', { roles, baseRevision });
}

export function resetChecklistRoles(): Promise<TemplatesSaveResult> {
  return write('DELETE', '/checklist-roles');
}
