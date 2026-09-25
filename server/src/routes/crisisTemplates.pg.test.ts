// Crisis templates + scoped IAP routes against a real Postgres. Skipped unless
// CRISIS_TEMPLATES_PG_TEST_URL is set (CI runs `npm test` without a database).
// Locally, with the dev cluster:
//   sudo -u postgres createdb -O gsoc gsoc_crisis_templates_test
//   CRISIS_TEMPLATES_PG_TEST_URL=postgres://gsoc:gsoc@localhost:5432/gsoc_crisis_templates_test npm test -w server
// It runs the app's real migration, then owns the crisis_template_overrides,
// iap_documents and share_links rows it creates (the tables are cleared).

import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express, { type Response as ExpressResponse } from 'express';
import cookieParser from 'cookie-parser';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { CrisisTemplatesConfig } from '../crisisTemplates/types';

const URL = process.env.CRISIS_TEMPLATES_PG_TEST_URL;

describe.skipIf(!URL)('crisis templates on Postgres', () => {
  let pool: Pool;
  let server: Server;
  let base = '';
  let admin = '';
  let member = '';
  const sse: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    process.env.JWT_SECRET ??= 'crisis-templates-test-secret';
    vi.resetModules();
    ({ pool } = await import('../db'));
    const { migrate } = await import('../migrate');
    await migrate();
    await migrate(); // idempotent — including the IAP index swap
    await pool.query('DELETE FROM crisis_template_overrides');

    const { signToken } = await import('../middleware/auth');
    admin = `gsoc_auth=${signToken({ id: '00000000-0000-0000-0000-00000000000a', email: 'ann@example.com', name: 'Ann Admin', role: 'admin' })}`;
    member = `gsoc_auth=${signToken({ id: '00000000-0000-0000-0000-00000000000b', email: 'max@example.com', name: 'Max Member', role: 'member' })}`;

    const { incidentSseClients } = await import('./incidentBus');
    incidentSseClients.add({ write: (s: string) => { sse.push(s); return true; } } as unknown as ExpressResponse);

    const app = express();
    app.use(cookieParser());
    app.use('/api/crisis', express.json({ limit: '50mb', inflate: false }));
    app.use('/api/iap', express.json({ limit: '25mb', inflate: false }));
    app.use('/api/crisis-templates', express.json({ limit: '2mb', inflate: false }));
    app.use('/api/crisis-templates', (await import('./crisisTemplates')).default);
    app.use('/api/iap', (await import('./iap')).default);
    app.use('/api/crisis', (await import('./crisis')).default);
    await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await pool?.end();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function call(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}): Promise<{ status: number; body: any; headers: Headers }> {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* not JSON (a PDF) */ }
    return { status: res.status, body, headers: res.headers };
  }

  const block = (c: CrisisTemplatesConfig, key: string) =>
    c.checklistBlocks.find((b) => `${b.scope.incidentType ?? '*'}|${b.scope.propertyId ?? '*'}` === key);
  const item = (id: string, text: string, roleId = 'ops') => ({ id, roleId, phase: 'immediate', text });

  describe('templates', () => {
    beforeEach(async () => {
      await pool.query('DELETE FROM crisis_template_overrides');
      sse.length = 0;
    });

    it('serves the defaults to any signed-in user; defaults + writes are admin-only', async () => {
      expect((await call('GET', '/api/crisis-templates')).status).toBe(401);
      const got = await call('GET', '/api/crisis-templates', { cookie: member });
      expect(got.status).toBe(200);
      expect(got.headers.get('cache-control')).toBe('private, no-cache');
      expect(got.body.checklistRoles).toMatchObject({ custom: false, revision: 0 });
      expect(got.body.checklistRoles.roles.map((r: { id: string }) => r.id)).toContain('gsoc-support');
      expect(block(got.body, '*|*')).toMatchObject({ custom: false, revision: 0 });

      expect((await call('GET', '/api/crisis-templates/defaults', { cookie: member })).status).toBe(403);
      expect((await call('GET', '/api/crisis-templates/defaults', { cookie: admin })).status).toBe(200);
      const put = await call('PUT', '/api/crisis-templates/checklist-blocks', {
        cookie: member, body: { scope: { incidentType: 'flood', propertyId: 'glacier' }, items: [], baseRevision: 0 },
      });
      expect(put.status).toBe(403);
    });

    it('saves, bumps revisions, 409s a stale save, resets — and tells editors each time', async () => {
      const scope = { incidentType: 'flood', propertyId: 'glacier' };
      const first = await call('PUT', '/api/crisis-templates/checklist-blocks', {
        cookie: admin, body: { scope, items: [item('x-fg-1', ' Check the McDonald Creek gauge ')], baseRevision: 0 },
      });
      expect(first.status).toBe(200);
      expect(block(first.body.config, 'flood|glacier')).toMatchObject({
        custom: true, updatedBy: 'Ann Admin', items: [item('x-fg-1', 'Check the McDonald Creek gauge')],
      });
      const r1: number = block(first.body.config, 'flood|glacier')!.revision;
      expect(r1).toBeGreaterThan(0);
      expect(sse.join('')).toMatch(/^event: templates\ndata: \{"at":"[^"]+"\}\n\n$/);

      const second = await call('PUT', '/api/crisis-templates/checklist-blocks', {
        cookie: admin, body: { scope, items: [item('x-fg-1', 'Check the gauge'), item('x-fg-2', 'Stage sandbags')], baseRevision: r1 },
      });
      const r2: number = block(second.body.config, 'flood|glacier')!.revision;
      expect(r2).toBeGreaterThan(r1);

      const stale = await call('PUT', '/api/crisis-templates/checklist-blocks', {
        cookie: admin, body: { scope, items: [], baseRevision: r1 },
      });
      expect(stale.status).toBe(409);
      expect(stale.body.error).toMatch(/was saved by Ann Admin after you started editing/);
      expect(block(stale.body.config, 'flood|glacier')).toMatchObject({ revision: r2 });

      // A no-op save changes nothing and broadcasts nothing.
      sse.length = 0;
      const same = await call('PUT', '/api/crisis-templates/checklist-blocks', {
        cookie: admin, body: { scope, items: [item('x-fg-1', 'Check the gauge'), item('x-fg-2', 'Stage sandbags')], baseRevision: r2 },
      });
      expect(same.status).toBe(200);
      expect(block(same.body.config, 'flood|glacier')).toMatchObject({ revision: r2 });
      expect(sse).toHaveLength(0);

      // A reset from a stale view can't delete a save it never saw.
      const staleReset = await call('DELETE', `/api/crisis-templates/checklist-blocks?scope=flood|glacier&baseRevision=${r1}`, { cookie: admin });
      expect(staleReset.status).toBe(409);
      expect(staleReset.body.error).toMatch(/was saved by Ann Admin after you started editing — reload that version before resetting/);
      expect(block(staleReset.body.config, 'flood|glacier')).toMatchObject({ revision: r2 });
      expect(sse).toHaveLength(0);

      const reset = await call('DELETE', `/api/crisis-templates/checklist-blocks?scope=flood|glacier&baseRevision=${r2}`, { cookie: admin });
      expect(reset.status).toBe(200);
      expect(block(reset.body.config, 'flood|glacier')).toBeUndefined();
      expect(sse).toHaveLength(1);
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM crisis_template_overrides');
      expect(rows[0].n).toBe(0);

      // A fresh override after a reset never reuses a revision an editor of an
      // earlier version may still hold, so that editor's save is still a 409.
      const again = await call('PUT', '/api/crisis-templates/checklist-blocks', {
        cookie: admin, body: { scope, items: [item('x-fg-1', 'Again')], baseRevision: 0 },
      });
      const r3: number = block(again.body.config, 'flood|glacier')!.revision;
      expect(r3).toBeGreaterThan(r2);
      for (const base of [r1, r2]) {
        const late = await call('PUT', '/api/crisis-templates/checklist-blocks', {
          cookie: admin, body: { scope, items: [item('x-fg-1', 'Late')], baseRevision: base },
        });
        expect(late.status).toBe(409);
      }
      // Saving it empty (no default for this scope) removes the override.
      const emptied = await call('PUT', '/api/crisis-templates/checklist-blocks', {
        cookie: admin, body: { scope, items: [], baseRevision: r3 },
      });
      expect(block(emptied.body.config, 'flood|glacier')).toBeUndefined();
    });

    it('validates bodies and cross-scope ids with readable 400s', async () => {
      const bad = async (body: unknown, path = 'checklist-blocks') =>
        (await call('PUT', `/api/crisis-templates/${path}`, { cookie: admin, body }));
      expect((await bad({ scope: { incidentType: 'nope' }, items: [], baseRevision: 0 })).body)
        .toEqual({ error: 'Unknown incident type "nope"' });
      expect((await bad({ scope: {}, items: [] })).body.error).toMatch(/baseRevision is required/);
      expect((await bad({ scope: {}, items: [item('x-a', '')], baseRevision: 0 })).body.error)
        .toBe('Operations Section Chief → Immediate, item 1 is empty — write the action or delete the item');

      const general = (await call('GET', '/api/crisis-templates', { cookie: admin })).body as CrisisTemplatesConfig;
      const takenId = block(general, '*|*')!.items[0].id;
      const clash = await bad({ scope: { incidentType: 'wildfire', propertyId: null }, items: [item(takenId, 'Dup')], baseRevision: 0 });
      expect(clash.status).toBe(400);
      expect(clash.body.error).toMatch(new RegExp(`"${takenId}", which already belongs to the General checklist`));

      expect((await call('DELETE', '/api/crisis-templates/checklist-blocks', { cookie: admin })).status).toBe(400);
      expect((await call('DELETE', '/api/crisis-templates/intake-blocks?scope=zzz', { cookie: admin })).status).toBe(400);
    });

    it('serializes concurrent saves of one scope: exactly one wins', async () => {
      const put = (text: string) => call('PUT', '/api/crisis-templates/checklist-blocks', {
        cookie: admin, body: { scope: { incidentType: 'wildfire', propertyId: 'custer' }, items: [item('x-race', text)], baseRevision: 0 },
      });
      const results = await Promise.all([put('A'), put('B'), put('C')]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    });

    it('guards roles in use, across roles and checklist writes', async () => {
      const cfg = (await call('GET', '/api/crisis-templates', { cookie: admin })).body as CrisisTemplatesConfig;
      const roles = cfg.checklistRoles.roles;
      const withoutOps = roles.filter((r) => r.id !== 'ops');
      const refused = await call('PUT', '/api/crisis-templates/checklist-roles', { cookie: admin, body: { roles: withoutOps, baseRevision: 0 } });
      expect(refused.status).toBe(400);
      expect(refused.body.error).toMatch(/^"Operations Section Chief" \(OSC\) is still assigned to \d+ checklist items/);

      const custom = { id: 'r-fnb', code: 'F&B', title: 'Food & Beverage Lead', color: '#0EA5E9', reportsTo: 'Logistics', directs: '' };
      const saved = await call('PUT', '/api/crisis-templates/checklist-roles', { cookie: admin, body: { roles: [...roles, custom], baseRevision: 0 } });
      expect(saved.status).toBe(200);
      expect(saved.body.config.checklistRoles).toMatchObject({ custom: true });
      expect(saved.body.config.checklistRoles.revision).toBeGreaterThan(0);
      expect(saved.body.config.checklistRoles.roles.at(-1)).toEqual({ ...custom, color: '#0ea5e9' });

      const assigned = await call('PUT', '/api/crisis-templates/checklist-blocks', {
        cookie: admin, body: { scope: { incidentType: null, propertyId: 'sea-island' }, items: [item('x-fnb-1', 'Feed sheltering guests', 'r-fnb')], baseRevision: 0 },
      });
      expect(assigned.status).toBe(200);
      const resetRefused = await call('DELETE', '/api/crisis-templates/checklist-roles', { cookie: admin });
      expect(resetRefused.status).toBe(400);
      expect(resetRefused.body.error).toMatch(/"Food & Beverage Lead" \(F&B\) is still assigned to 1 checklist item/);

      await call('DELETE', '/api/crisis-templates/checklist-blocks?scope=*|sea-island', { cookie: admin });
      const staleReset = await call('DELETE', '/api/crisis-templates/checklist-roles?baseRevision=0', { cookie: admin });
      expect(staleReset.status).toBe(409);
      expect(staleReset.body.config.checklistRoles.custom).toBe(true);
      const reset = await call('DELETE', `/api/crisis-templates/checklist-roles?baseRevision=${saved.body.config.checklistRoles.revision}`, { cookie: admin });
      expect(reset.status).toBe(200);
      expect(reset.body.config.checklistRoles).toMatchObject({ custom: false, revision: 0 });
    });

    it('saves and resets intake blocks', async () => {
      const groups = [{ id: 'x-g', label: 'Trail', questions: [{ id: 'x-q-1', text: 'Which trailhead?' }] }];
      const saved = await call('PUT', '/api/crisis-templates/intake-blocks', {
        cookie: admin, body: { scope: { incidentType: 'search-rescue', propertyId: 'rocky-mountain' }, groups, baseRevision: 0 },
      });
      expect(saved.status).toBe(200);
      type Scoped = { scope: { incidentType: string | null; propertyId: string | null } };
      const find = (c: CrisisTemplatesConfig) =>
        c.intakeBlocks.find((x: Scoped) => x.scope.incidentType === 'search-rescue' && x.scope.propertyId === 'rocky-mountain');
      const b = find(saved.body.config)!;
      expect(b).toMatchObject({ custom: true, groups });
      expect((await call('DELETE', `/api/crisis-templates/intake-blocks?scope=search-rescue|rocky-mountain&baseRevision=${b.revision + 1}`, { cookie: admin })).status).toBe(409);
      const reset = await call('DELETE', `/api/crisis-templates/intake-blocks?scope=search-rescue|rocky-mountain&baseRevision=${b.revision}`, { cookie: admin });
      expect(reset.status).toBe(200);
      expect(find(reset.body.config)).toBeUndefined();
    });

    it('degrades to the defaults when the overrides table is missing', async () => {
      await pool.query('ALTER TABLE crisis_template_overrides RENAME TO crisis_template_overrides_away');
      try {
        const got = await call('GET', '/api/crisis-templates', { cookie: member });
        expect(got.status).toBe(200);
        expect(got.body.checklistBlocks.length).toBeGreaterThan(0);
        const put = await call('PUT', '/api/crisis-templates/checklist-blocks', {
          cookie: admin, body: { scope: { incidentType: 'flood', propertyId: null }, items: [], baseRevision: 0 },
        });
        expect(put.status).toBe(503);
        expect(put.body.error).toMatch(/migration pending/);
      } finally {
        await pool.query('ALTER TABLE crisis_template_overrides_away RENAME TO crisis_template_overrides');
      }
    });
  });

  describe('share templates', () => {
    const token = '11111111-2222-3333-4444-555555555555';
    const expired = '11111111-2222-3333-4444-666666666666';

    beforeAll(async () => {
      await pool.query('DELETE FROM crisis_template_overrides');
      await pool.query('DELETE FROM share_links WHERE token IN ($1, $2)', [token, expired]);
      const cfg = (await call('GET', '/api/crisis-templates', { cookie: admin })).body as CrisisTemplatesConfig;
      const generalId = block(cfg, '*|*')!.items[0].id;
      // An admin-only scope for another property, which the incident used to be at.
      await call('PUT', '/api/crisis-templates/checklist-blocks', {
        cookie: admin, body: { scope: { incidentType: null, propertyId: 'yellowstone' }, items: [item('x-ys-1', 'Old Faithful muster')], baseRevision: 0 },
      });
      await call('PUT', '/api/crisis-templates/checklist-blocks', {
        cookie: admin, body: { scope: { incidentType: 'hazmat', propertyId: 'glacier' }, items: [item('x-hg-1', 'Close Going-to-the-Sun Road')], baseRevision: 0 },
      });
      const snapshot = {
        incidentName: 'Test', incidentType: 'chemical', locationGroupId: 'glacier',
        checklists: { [generalId]: { checked: true, at: '2026-09-01T00:00:00Z' }, 'x-ys-1': { checked: true, at: '2026-09-01T00:00:00Z' } },
        intake: {},
      };
      await pool.query(
        `INSERT INTO share_links (token, incident_id, snapshot, expires_at) VALUES
           ($1, NULL, $3, NOW() + interval '1 hour'), ($2, NULL, $3, NOW() - interval '1 hour')`,
        [token, expired, JSON.stringify(snapshot)]
      );
    });

    it('answers only the applicable scopes, without editor names, with retired text', async () => {
      const r = await call('GET', `/api/crisis/share/${token}/templates`, { cookie: member });
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
      const keys = r.body.checklistBlocks.map((b: { scope: { incidentType: string | null; propertyId: string | null } }) =>
        `${b.scope.incidentType ?? '*'}|${b.scope.propertyId ?? '*'}`);
      // 'chemical' resolves as hazmat; glacier is the property.
      expect(keys).toContain('*|*');
      expect(keys).toContain('hazmat|glacier');
      expect(keys.every((k: string) => ['*|*', 'hazmat|*', '*|glacier', 'hazmat|glacier'].includes(k))).toBe(true);
      expect(r.body.checklistBlocks.every((b: { updatedBy: unknown }) => b.updatedBy === null)).toBe(true);
      expect(r.body.retiredChecklistItems).toEqual({ 'x-ys-1': { text: 'Old Faithful muster', roleId: 'ops', phase: 'immediate' } });
    });

    it('is gated like the snapshot', async () => {
      expect((await call('GET', `/api/crisis/share/${token}/templates`)).status).toBe(401);
      expect((await call('GET', `/api/crisis/share/${expired}/templates`, { cookie: member })).status).toBe(410);
      expect((await call('GET', '/api/crisis/share/00000000-0000-0000-0000-000000000000/templates', { cookie: member })).status).toBe(404);
    });

    afterAll(async () => {
      await pool.query('DELETE FROM share_links WHERE token IN ($1, $2)', [token, expired]);
    });
  });

  describe('share checklist toggle', () => {
    const token = '11111111-2222-3333-4444-888888888888';
    const incidentId = 'crisis-templates-toggle-test';
    let generalId = '';
    let foreignId = '';

    beforeAll(async () => {
      await pool.query('DELETE FROM crisis_template_overrides');
      await pool.query('DELETE FROM share_links WHERE token = $1', [token]);
      await pool.query('DELETE FROM incidents WHERE id = $1', [incidentId]);
      const cfg = (await call('GET', '/api/crisis-templates', { cookie: admin })).body as CrisisTemplatesConfig;
      generalId = block(cfg, '*|*')!.items[0].id;
      // A line only a Yellowstone incident shows — the incident is at Glacier.
      foreignId = block(cfg, '*|yellowstone')!.items[0].id;
      await pool.query('INSERT INTO incidents (id, data) VALUES ($1, $2)', [incidentId, JSON.stringify({ id: incidentId, checklists: {} })]);
      await pool.query(
        `INSERT INTO share_links (token, incident_id, snapshot, expires_at) VALUES ($1, $2, $3, NOW() + interval '1 hour')`,
        [token, incidentId, JSON.stringify({ incidentName: 'Toggle', incidentType: 'wildfire', locationGroupId: 'glacier', checklists: {} })]
      );
    });

    afterAll(async () => {
      await pool.query('DELETE FROM share_links WHERE token = $1', [token]);
      await pool.query('DELETE FROM incidents WHERE id = $1', [incidentId]);
    });

    const toggle = (id: string) =>
      call('POST', `/api/crisis/share/${token}/checklist/${id}`, { cookie: member, body: { checked: true, by: 'Viewer' } });
    const stored = async () =>
      (await pool.query<{ data: { checklists: Record<string, unknown> } }>('SELECT data FROM incidents WHERE id = $1', [incidentId])).rows[0].data.checklists;

    it('toggles a line of the incident\'s own checklist', async () => {
      const r = await toggle(generalId);
      expect(r.status).toBe(200);
      expect(r.body.checklists[generalId]).toMatchObject({ checked: true, by: 'Max Member' });
      expect(Object.keys(await stored())).toEqual([generalId]);
    });

    it('refuses another scope\'s line, so it is neither stored nor read back as retired text', async () => {
      for (const id of [foreignId, 'x-not-a-line']) {
        const r = await toggle(id);
        expect(r.status).toBe(409);
        expect(r.body.error).toMatch(/not on this incident's current checklist/);
      }
      expect(Object.keys(await stored())).toEqual([generalId]);
      const t = await call('GET', `/api/crisis/share/${token}/templates`, { cookie: member });
      expect(t.body.retiredChecklistItems).toEqual({});
    });
  });

  describe('IAP by type and property', () => {
    const pdf = (tag: string) => Buffer.from(`%PDF-1.4\n% ${tag}\n`).toString('base64');
    const upload = (name: string, incidentType: string | null, propertyId: string | null) =>
      call('POST', '/api/iap', { cookie: admin, body: { name, incidentType, propertyId, dataBase64: pdf(name) } });
    const token = '11111111-2222-3333-4444-777777777777';

    beforeAll(async () => {
      await pool.query('DELETE FROM iap_documents');
      await pool.query('DELETE FROM share_links WHERE token = $1', [token]);
    });

    afterAll(async () => {
      await pool.query('DELETE FROM share_links WHERE token = $1', [token]);
    });

    it('files one document per (type, property) and resolves the most specific', async () => {
      expect((await upload('General', null, null)).status).toBe(200);
      expect((await upload('Glacier', null, 'glacier')).status).toBe(200);
      expect((await upload('Wildfire', 'wildfire', null)).status).toBe(200);
      const both = await upload('Wildfire at Glacier', 'wildfire', 'glacier');
      expect(both.body).toMatchObject({ incident_type: 'wildfire', location_group_id: 'glacier' });

      const resolve = async (q: string) => (await call('GET', `/api/iap/resolve?${q}`, { cookie: member })).body;
      expect(await resolve('type=wildfire&property=glacier')).toMatchObject({ match: 'type+property', doc: { name: 'Wildfire at Glacier' } });
      expect(await resolve('type=wildfire&property=yellowstone')).toMatchObject({ match: 'type', doc: { name: 'Wildfire' } });
      expect(await resolve('type=flood&property=glacier')).toMatchObject({ match: 'property', doc: { name: 'Glacier' } });
      expect(await resolve('type=flood')).toMatchObject({ match: 'general', doc: { name: 'General' } });
      // A retired type id resolves as its successor.
      await upload('Hazmat', 'hazmat', null);
      expect(await resolve('type=chemical')).toMatchObject({ match: 'type', doc: { name: 'Hazmat' } });

      // Replacing a scope keeps one row for it, under a new id.
      const replaced = await upload('Glacier v2', null, 'glacier');
      expect(replaced.status).toBe(200);
      const { rows } = await pool.query("SELECT name FROM iap_documents WHERE location_group_id = 'glacier' AND incident_type IS NULL");
      expect(rows).toEqual([{ name: 'Glacier v2' }]);

      const list = await call('GET', '/api/iap', { cookie: member });
      expect(list.body.map((d: { name: string }) => d.name)).toEqual(['General', 'Glacier v2', 'Hazmat', 'Wildfire', 'Wildfire at Glacier']);

      await pool.query('DELETE FROM iap_documents');
      expect(await resolve('type=flood&property=glacier')).toEqual({ doc: null, match: null });
    });

    it('rejects bad scope input', async () => {
      expect((await call('POST', '/api/iap', { cookie: admin, body: { name: 'x', propertyId: 'Bad Id', dataBase64: pdf('x') } })).status).toBe(400);
      expect((await call('POST', '/api/iap', { cookie: admin, body: { name: 'x', incidentType: 'chemical', dataBase64: pdf('x') } })).status).toBe(400);
      expect((await call('GET', '/api/iap/resolve?property=Bad%20Id', { cookie: member })).status).toBe(400);
      expect((await call('GET', '/api/iap/resolve?type=flood')).status).toBe(401);
    });

    it('serves the share link the property-specific document', async () => {
      await upload('General', null, null);
      await upload('Glacier', null, 'glacier');
      await pool.query(
        `INSERT INTO share_links (token, snapshot, expires_at) VALUES ($1, $2, NOW() + interval '1 hour')`,
        [token, JSON.stringify({ incidentType: 'flood', locationGroupId: 'glacier' })]
      );
      const r = await call('GET', `/api/crisis/share/${token}/iap`, { cookie: member });
      expect(r.status).toBe(200);
      expect(r.headers.get('x-iap-name')).toBe('Glacier');
    });
  });
});
