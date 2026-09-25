// Share snapshot writes against a real Postgres: the auto-publish PATCH and the
// checklist fanout (updateShareChecklists) must not undo each other when they
// overlap. Skipped unless CRISIS_SHARE_PG_TEST_URL is set (CI runs `npm test`
// without a database). Locally, with the dev cluster:
//   sudo -u postgres createdb -O gsoc gsoc_share_race_test
//   CRISIS_SHARE_PG_TEST_URL=postgres://gsoc:gsoc@localhost:5432/gsoc_share_race_test npm test -w server
// It runs the app's real migration and owns the incidents / share_links rows
// it creates (fixed ids, deleted before and after).

import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

const URL = process.env.CRISIS_SHARE_PG_TEST_URL;

describe.skipIf(!URL)('share snapshot writes on Postgres', () => {
  let pool: Pool;
  let server: Server;
  let base = '';
  let member = '';
  let updateShareChecklists: (id: string, map: Record<string, { checked: boolean; at: string; by?: string }>) => Promise<void>;

  const incidentId = 'share-race-test-incident';
  const token = 'aaaaaaaa-0000-4000-8000-000000000001';
  const other = 'aaaaaaaa-0000-4000-8000-000000000002';
  const revoked = 'aaaaaaaa-0000-4000-8000-000000000003';
  const v1 = { 'ic-imm-1': { checked: true, at: '2026-09-25T10:00:00.000Z', by: 'Viewer' } };
  const v2 = { ...v1, 'ic-imm-2': { checked: true, at: '2026-09-25T10:01:00.000Z', by: 'Ops' } };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    process.env.JWT_SECRET ??= 'crisis-share-test-secret';
    vi.resetModules();
    ({ pool } = await import('../db'));
    const { migrate } = await import('../migrate');
    await migrate();

    const { signToken } = await import('../middleware/auth');
    member = `gsoc_auth=${signToken({ id: '00000000-0000-0000-0000-00000000000b', email: 'max@example.com', name: 'Max Member', role: 'member' })}`;

    const crisis = await import('./crisis');
    updateShareChecklists = crisis.updateShareChecklists;
    const app = express();
    app.use(cookieParser());
    app.use('/api/crisis', express.json({ limit: '50mb', inflate: false }));
    app.use('/api/crisis', crisis.default);
    await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  const cleanup = async () => {
    await pool.query('DELETE FROM share_links WHERE token IN ($1, $2, $3)', [token, other, revoked]);
    await pool.query('DELETE FROM incidents WHERE id = $1', [incidentId]);
  };

  beforeEach(async () => {
    await cleanup();
    await pool.query('INSERT INTO incidents (id, data) VALUES ($1, $2)', [incidentId, JSON.stringify({ id: incidentId, checklists: v1 })]);
    await pool.query(
      `INSERT INTO share_links (token, incident_id, snapshot, expires_at, active) VALUES
         ($1, $4, $5, NOW() + interval '1 hour', TRUE),
         ($2, $4, $6, NOW() + interval '1 hour', TRUE),
         ($3, $4, $5, NOW() + interval '1 hour', FALSE)`,
      [token, other, revoked, incidentId,
        JSON.stringify({ incidentName: 'Before', incidentStatus: 'active', checklists: v1 }),
        JSON.stringify({ incidentName: 'Legacy' })]
    );
  });

  afterAll(async () => {
    if (pool) await cleanup();
    await new Promise((resolve) => server?.close(resolve));
    await pool?.end();
  });

  const patch = (tok: string, body: unknown) =>
    fetch(`${base}/api/crisis/share/${tok}`, {
      method: 'PATCH',
      headers: { cookie: member, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const snapshotOf = async (tok: string) =>
    (await pool.query<{ snapshot: Record<string, unknown> }>('SELECT snapshot FROM share_links WHERE token = $1', [tok])).rows[0].snapshot;

  /** Open the viewer stream and resolve with the first `update` event's data. */
  async function nextUpdate(tok: string): Promise<{ read: Promise<Record<string, unknown>>; close: () => void }> {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/crisis/share/${tok}/events`, { headers: { cookie: member }, signal: ctrl.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    // Wait for the `connected` event so the server has registered this client.
    while (!buf.includes('event: connected')) buf += decoder.decode((await reader.read()).value, { stream: true });
    buf = buf.slice(buf.indexOf('\n\n') + 2);
    const read = (async () => {
      for (;;) {
        const m = /event: update\ndata: (.*)\n\n/.exec(buf);
        if (m) return JSON.parse(m[1]) as Record<string, unknown>;
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended');
        buf += decoder.decode(value, { stream: true });
      }
    })();
    return { read, close: () => ctrl.abort() };
  }

  it('merges the published state, keeps the snapshot\'s own checklist map, and pushes it to viewers', async () => {
    const stream = await nextUpdate(token);
    try {
      const r = await patch(token, { incidentName: 'After', checklists: {}, lastUpdated: 'client clock' });
      expect(r.status).toBe(200);
      const pushed = await stream.read;
      const stored = await snapshotOf(token);
      expect(stored).toMatchObject({ incidentName: 'After', incidentStatus: 'active', checklists: v1 });
      expect(stored.lastUpdated).not.toBe('client clock');
      expect(Date.parse(String(stored.lastUpdated))).not.toBeNaN();
      expect(pushed).toEqual(stored);
    } finally {
      stream.close();
    }
  });

  it('seeds the map on a snapshot that has none', async () => {
    expect((await patch(other, { incidentName: 'Seeded', checklists: v2 })).status).toBe(200);
    expect(await snapshotOf(other)).toMatchObject({ incidentName: 'Seeded', checklists: v2 });
  });

  it('refuses a dead link, an unknown one, and a non-object body', async () => {
    expect((await patch(revoked, { incidentName: 'x' })).status).toBe(404);
    expect((await patch('aaaaaaaa-0000-4000-8000-00000000ffff', { incidentName: 'x' })).status).toBe(404);
    expect((await patch(token, [1, 2])).status).toBe(400);
    expect(await snapshotOf(revoked)).toMatchObject({ incidentName: 'Before' });
  });

  it('a PATCH overlapping a checklist fanout keeps the fanout\'s map', async () => {
    // A fanout that has written the share row but not committed yet…
    const fanout = await pool.connect();
    try {
      await fanout.query('BEGIN');
      await fanout.query(
        `UPDATE share_links SET snapshot = snapshot || jsonb_build_object('checklists', $2::jsonb) WHERE token = $1`,
        [token, JSON.stringify(v2)]
      );
      // …while the editor's auto-publish arrives carrying the old map.
      const pending = patch(token, { incidentName: 'Published', checklists: v1 });
      await new Promise((r) => setTimeout(r, 300));
      await fanout.query('COMMIT');
      expect((await pending).status).toBe(200);
    } finally {
      fanout.release();
    }
    expect(await snapshotOf(token)).toMatchObject({ incidentName: 'Published', checklists: v2 });
  });

  it('fans out the incident row\'s CURRENT map, after any toggle still holding the row', async () => {
    // A toggle holds the incident row and is about to commit v2…
    const toggle = await pool.connect();
    let done: Promise<void>;
    try {
      await toggle.query('BEGIN');
      await toggle.query('SELECT data FROM incidents WHERE id = $1 FOR UPDATE', [incidentId]);
      await toggle.query(
        `UPDATE incidents SET data = jsonb_set(data, '{checklists}', $2::jsonb) WHERE id = $1`,
        [incidentId, JSON.stringify(v2)]
      );
      // …while the fanout of an EARLIER toggle (carrying v1) is still running.
      done = updateShareChecklists(incidentId, v1);
      await new Promise((r) => setTimeout(r, 300));
      await toggle.query('COMMIT');
    } finally {
      toggle.release();
    }
    await done;
    expect((await snapshotOf(token)).checklists).toEqual(v2);
    expect((await snapshotOf(other)).checklists).toEqual(v2);
    expect(await snapshotOf(token)).toMatchObject({ incidentName: 'Before' });
    // A revoked link is left alone.
    expect((await snapshotOf(revoked)).checklists).toEqual(v1);
  });

  it('pushes the fanout to connected viewers', async () => {
    const stream = await nextUpdate(token);
    try {
      await updateShareChecklists(incidentId, v1);
      const pushed = await stream.read;
      expect(pushed).toMatchObject({ incidentName: 'Before', checklists: v1 });
    } finally {
      stream.close();
    }
  });
});
