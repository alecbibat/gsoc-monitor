import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { wrap } from '../asyncWrap';
import { broadcastTemplates } from './incidentBus';
import { broadcastShareTemplates } from './crisis';
import { cleanText, parseBaseRevision, parseScope, parseScopeParam } from '../crisisTemplates/validate';
import {
  defaultTemplatesConfig, isUndefinedTable, loadEffectiveConfig,
  resetChecklistBlock, resetChecklistRoles, resetIntakeBlock,
  saveChecklistBlock, saveChecklistRoles, saveIntakeBlock,
  type WriteOutcome,
} from '../crisisTemplates/store';

// ── Crisis templates: checklists, intake questions, checklist roles ──────────
//
// Every signed-in editor reads the effective config (built-in defaults +
// admin overrides) and resolves it per incident client-side; admins edit it
// one unit at a time — a scope's checklist block, a scope's intake block, or
// the global role list — through Admin → Checklists / Intake / Roles. Each
// save carries the revision it was based on (409 on a mismatch) and the
// response is the whole new config, which the editor adopts directly. Other
// editors hear about it on the incidents SSE stream (`templates` event) and
// refetch. The rules live in crisisTemplates/ (validate, plan, store).

const router = Router();

const TAG = 'crisis-templates';

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function actorOf(req: Request): string | null {
  return cleanText(req.user?.name).slice(0, 120) || null;
}

function send(res: Response, out: WriteOutcome): void {
  if (!out.ok) {
    res.status(out.status).json(out.status === 409 ? { error: out.error, config: out.config } : { error: out.error });
    return;
  }
  if (out.changed) {
    broadcastTemplates();
    broadcastShareTemplates();
  }
  res.json({ config: out.config });
}

/**
 * Like wrap(), but a write against a database whose migration never created
 * the overrides table says so, instead of a generic 503.
 */
function wrapWrite(fn: (req: Request, res: Response) => Promise<void>) {
  return wrap(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (!isUndefinedTable(err)) throw err;
      console.error(`[${TAG}] write refused: crisis_template_overrides does not exist`);
      res.status(503).json({ error: 'Template storage is not set up yet (database migration pending) — try again in a few minutes' });
    }
  }, TAG);
}

// GET /api/crisis-templates — the effective config (any signed-in user).
// no-cache (not no-store): the browser revalidates every time, and the
// ETag Express computes turns an unchanged config into a bodiless 304.
router.get('/', requireAuth, wrap(async (_req: Request, res: Response) => {
  const config = await loadEffectiveConfig();
  res.setHeader('Cache-Control', 'private, no-cache');
  res.json(config);
}, TAG));

// GET /api/crisis-templates/defaults — the built-in defaults alone, for the
// editor's "compare with default" view.
router.get('/defaults', requireAdmin, (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, no-cache');
  res.json(defaultTemplatesConfig());
});

// PUT /api/crisis-templates/checklist-blocks — { scope, items, baseRevision }
router.put('/checklist-blocks', requireAdmin, wrapWrite(async (req, res) => {
  const body = isObject(req.body) ? req.body : {};
  const scope = parseScope(body.scope);
  if (!scope.ok) { res.status(400).json({ error: scope.error }); return; }
  const base = parseBaseRevision(body.baseRevision);
  if (!base.ok) { res.status(400).json({ error: base.error }); return; }
  send(res, await saveChecklistBlock(scope.value, body.items, base.value, actorOf(req)));
}));

// DELETE /api/crisis-templates/checklist-blocks?scope=<scopeKey> — reset to default.
router.delete('/checklist-blocks', requireAdmin, wrapWrite(async (req, res) => {
  const scope = parseScopeParam(req.query.scope);
  if (!scope.ok) { res.status(400).json({ error: scope.error }); return; }
  send(res, await resetChecklistBlock(scope.value));
}));

// PUT /api/crisis-templates/intake-blocks — { scope, groups, baseRevision }
router.put('/intake-blocks', requireAdmin, wrapWrite(async (req, res) => {
  const body = isObject(req.body) ? req.body : {};
  const scope = parseScope(body.scope);
  if (!scope.ok) { res.status(400).json({ error: scope.error }); return; }
  const base = parseBaseRevision(body.baseRevision);
  if (!base.ok) { res.status(400).json({ error: base.error }); return; }
  send(res, await saveIntakeBlock(scope.value, body.groups, base.value, actorOf(req)));
}));

// DELETE /api/crisis-templates/intake-blocks?scope=<scopeKey> — reset to default.
router.delete('/intake-blocks', requireAdmin, wrapWrite(async (req, res) => {
  const scope = parseScopeParam(req.query.scope);
  if (!scope.ok) { res.status(400).json({ error: scope.error }); return; }
  send(res, await resetIntakeBlock(scope.value));
}));

// PUT /api/crisis-templates/checklist-roles — { roles, baseRevision }
router.put('/checklist-roles', requireAdmin, wrapWrite(async (req, res) => {
  const body = isObject(req.body) ? req.body : {};
  const base = parseBaseRevision(body.baseRevision);
  if (!base.ok) { res.status(400).json({ error: base.error }); return; }
  send(res, await saveChecklistRoles(body.roles, base.value, actorOf(req)));
}));

// DELETE /api/crisis-templates/checklist-roles — reset to default.
router.delete('/checklist-roles', requireAdmin, wrapWrite(async (_req, res) => {
  send(res, await resetChecklistRoles());
}));

export default router;
