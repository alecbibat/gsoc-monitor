// ── Crisis templates — storage ───────────────────────────────────────────────
//
// Admin overrides live in crisis_template_overrides (migrate.ts), one row per
// (kind, scope_key); everything else is the built-in defaults in code. Reads
// are a single small SELECT assembled in memory (effective.ts). Every write
// runs in one transaction holding a transaction-scoped advisory lock, so the
// revision check and the cross-block validation in plan.ts see the same
// config the write lands on — two admins saving different scopes that claim
// the same item id, or one deleting a role while another assigns items to it,
// serialize instead of both passing their checks.
//
// Revisions are drawn from crisis_template_revision_seq (migrate.ts), not
// counted per row: a reset deletes the row, so "current + 1" would hand the
// next save of that scope a number an admin still editing the old override
// holds, and their save would pass the check and overwrite it. From one
// sequence no number is issued twice; editors only ever compare them.

import type { PoolClient } from 'pg';
import { pool } from '../db';
import {
  DEFAULT_CHECKLIST_BLOCKS, DEFAULT_CHECKLIST_ROLES, DEFAULT_INTAKE_BLOCKS,
} from '../data/crisisTemplateDefaults';
import { scopeKey, type CrisisTemplatesConfig, type TemplateScope } from './types';
import {
  ROLES_SCOPE_KEY, buildEffectiveConfig, indexDefaults,
  type DefaultsIndex, type OverrideKind, type OverrideRow,
} from './effective';
import {
  decideChecklistReset, decideChecklistSave, decideIntakeReset, decideIntakeSave,
  decideRolesReset, decideRolesSave, type WriteDecision,
} from './plan';

const UNDEFINED_TABLE = '42P01';
const COLUMNS = 'kind, scope_key, data, revision, updated_at, updated_by';

let defaultsIndex: DefaultsIndex | null = null;
/** The built-in defaults, indexed once (they are constant for the process). */
export function templateDefaults(): DefaultsIndex {
  defaultsIndex ??= indexDefaults({
    roles: DEFAULT_CHECKLIST_ROLES,
    checklistBlocks: DEFAULT_CHECKLIST_BLOCKS,
    intakeBlocks: DEFAULT_INTAKE_BLOCKS,
  });
  return defaultsIndex;
}

// Warn once per distinct message: the effective config is rebuilt on every
// read, and a bad row would otherwise log on each incident open.
const warned = new Set<string>();
function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(msg);
}

export function isUndefinedTable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === UNDEFINED_TABLE;
}

/** Built-in defaults only (every block custom=false, revision 0). */
export function defaultTemplatesConfig(): CrisisTemplatesConfig {
  return buildEffectiveConfig(templateDefaults(), []);
}

/**
 * The effective config. If the overrides table doesn't exist yet (the boot
 * migration failed or hasn't run), serve the defaults rather than failing:
 * checklists and intake must keep working through a half-migrated deploy.
 */
export async function loadEffectiveConfig(): Promise<CrisisTemplatesConfig> {
  let rows: OverrideRow[];
  try {
    ({ rows } = await pool.query<OverrideRow>(`SELECT ${COLUMNS} FROM crisis_template_overrides`));
  } catch (err) {
    if (!isUndefinedTable(err)) throw err;
    warnOnce('[crisis-templates] crisis_template_overrides is missing (migration not applied?) — serving built-in defaults');
    rows = [];
  }
  return buildEffectiveConfig(templateDefaults(), rows, warnOnce);
}

export type WriteOutcome =
  | { ok: true; config: CrisisTemplatesConfig; changed: boolean }
  | { ok: false; status: 400 | 409; error: string; config?: CrisisTemplatesConfig };

type Decide = (config: CrisisTemplatesConfig, defaults: DefaultsIndex) => WriteDecision;

/** Decide + apply one unit's write under the templates lock; returns the resulting config. */
async function writeUnit(kind: OverrideKind, key: string, actor: string | null, decide: Decide): Promise<WriteOutcome> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('crisis_templates'))");
    const defaults = templateDefaults();
    const { rows } = await client.query<OverrideRow>(`SELECT ${COLUMNS} FROM crisis_template_overrides`);
    const config = buildEffectiveConfig(defaults, rows, warnOnce);
    const decision = decide(config, defaults);

    if (decision.type === 'reject' || decision.type === 'noop') {
      await client.query('ROLLBACK');
      if (decision.type === 'noop') return { ok: true, config, changed: false };
      // A conflict hands back the current config so the editor can offer
      // "reload their version" without a second round trip.
      return decision.status === 409
        ? { ok: false, status: 409, error: decision.error, config }
        : { ok: false, status: 400, error: decision.error };
    }

    const others = rows.filter((r) => !(r.kind === kind && r.scope_key === key));
    let next: OverrideRow[];
    if (decision.type === 'delete') {
      await client.query('DELETE FROM crisis_template_overrides WHERE kind = $1 AND scope_key = $2', [kind, key]);
      next = others;
    } else {
      const { rows: [row] } = await client.query<OverrideRow>(
        `INSERT INTO crisis_template_overrides (kind, scope_key, data, revision, updated_at, updated_by)
         VALUES ($1, $2, $3, nextval('crisis_template_revision_seq'), NOW(), $4)
         ON CONFLICT (kind, scope_key) DO UPDATE SET
           data = EXCLUDED.data, revision = EXCLUDED.revision,
           updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
         RETURNING ${COLUMNS}`,
        [kind, key, JSON.stringify(decision.data), actor]
      );
      next = [...others, row];
    }
    await client.query('COMMIT');
    return { ok: true, config: buildEffectiveConfig(defaults, next, warnOnce), changed: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* connection already gone */ });
    throw err;
  } finally {
    client.release();
  }
}

export function saveChecklistBlock(scope: TemplateScope, items: unknown, baseRevision: number, actor: string | null) {
  return writeUnit('checklist-block', scopeKey(scope), actor,
    (config, defaults) => decideChecklistSave(config, defaults, scope, items, baseRevision));
}

export function resetChecklistBlock(scope: TemplateScope, baseRevision: number | null) {
  return writeUnit('checklist-block', scopeKey(scope), null,
    (config, defaults) => decideChecklistReset(config, defaults, scope, baseRevision));
}

export function saveIntakeBlock(scope: TemplateScope, groups: unknown, baseRevision: number, actor: string | null) {
  return writeUnit('intake-block', scopeKey(scope), actor,
    (config, defaults) => decideIntakeSave(config, defaults, scope, groups, baseRevision));
}

export function resetIntakeBlock(scope: TemplateScope, baseRevision: number | null) {
  return writeUnit('intake-block', scopeKey(scope), null,
    (config, defaults) => decideIntakeReset(config, defaults, scope, baseRevision));
}

export function saveChecklistRoles(roles: unknown, baseRevision: number, actor: string | null) {
  return writeUnit('checklist-roles', ROLES_SCOPE_KEY, actor,
    (config, defaults) => decideRolesSave(config, defaults, roles, baseRevision));
}

export function resetChecklistRoles(baseRevision: number | null) {
  return writeUnit('checklist-roles', ROLES_SCOPE_KEY, null,
    (config, defaults) => decideRolesReset(config, defaults, baseRevision));
}
