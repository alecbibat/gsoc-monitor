// Route-level checks that answer before any database access (auth, input
// validation, the defaults endpoint, the SSE cue). The full save / conflict /
// reset / share flows run against Postgres in crisisTemplates.pg.test.ts.

import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express, { type Response as ExpressResponse } from 'express';
import cookieParser from 'cookie-parser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signToken } from '../middleware/auth';
import crisisTemplatesRouter from './crisisTemplates';
import iapRouter from './iap';
import { broadcastTemplates, incidentSseClients } from './incidentBus';

process.env.JWT_SECRET ??= 'crisis-templates-route-test';

let server: Server;
let base = '';
const cookie = (role: 'admin' | 'member') =>
  `gsoc_auth=${signToken({ id: `id-${role}`, email: `${role}@example.com`, name: `A ${role}`, role })}`;

beforeAll(async () => {
  const app = express();
  app.use(cookieParser());
  app.use('/api/crisis-templates', express.json({ limit: '2mb', inflate: false }));
  app.use(express.json());
  app.use('/api/crisis-templates', crisisTemplatesRouter);
  app.use('/api/iap', iapRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(method: string, path: string, who?: 'admin' | 'member', body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(who ? { cookie: cookie(who) } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

describe('crisis-templates routes (no database)', () => {
  it('require a session to read and an admin to write', async () => {
    expect((await call('GET', '/api/crisis-templates')).status).toBe(401);
    expect((await call('GET', '/api/crisis-templates/defaults', 'member')).status).toBe(403);
    for (const [method, path] of [
      ['PUT', 'checklist-blocks'], ['DELETE', 'checklist-blocks?scope=*|*'],
      ['PUT', 'intake-blocks'], ['DELETE', 'intake-blocks?scope=*|*'],
      ['PUT', 'checklist-roles'], ['DELETE', 'checklist-roles'],
    ]) {
      expect((await call(method, `/api/crisis-templates/${path}`, 'member', method === 'PUT' ? {} : undefined)).status).toBe(403);
      expect((await call(method, `/api/crisis-templates/${path}`)).status).toBe(401);
    }
  });

  it('serves the built-in defaults to admins', async () => {
    const r = await call('GET', '/api/crisis-templates/defaults', 'admin');
    expect(r.status).toBe(200);
    expect(r.body.checklistRoles).toMatchObject({ custom: false, revision: 0, updatedBy: null });
    expect(r.body.checklistRoles.roles[0].id).toBe('ic');
    expect(r.body.checklistBlocks[0]).toMatchObject({ scope: { incidentType: null, propertyId: null }, custom: false });
  });

  it('rejects malformed write bodies with a readable 400', async () => {
    const put = (path: string, body: unknown) => call('PUT', `/api/crisis-templates/${path}`, 'admin', body);
    expect(await put('checklist-blocks', { items: [], baseRevision: 0 }))
      .toEqual({ status: 400, body: { error: 'scope must be an object { incidentType, propertyId }' } });
    expect((await put('checklist-blocks', { scope: { incidentType: 'security' }, items: [], baseRevision: 0 })).body.error)
      .toBe('Unknown incident type "security"');
    expect((await put('intake-blocks', { scope: { propertyId: 'Sea Island' }, groups: [], baseRevision: 0 })).body.error)
      .toBe('Invalid property id "Sea Island"');
    expect((await put('checklist-roles', { roles: [], baseRevision: -1 })).body.error).toMatch(/^baseRevision is required/);
    expect((await put('checklist-blocks', [])).status).toBe(400);
    expect((await call('DELETE', '/api/crisis-templates/checklist-blocks?scope=nope', 'admin')).body.error)
      .toBe('Invalid scope "nope"');
    expect((await call('DELETE', '/api/crisis-templates/intake-blocks', 'admin')).body.error)
      .toMatch(/scope query parameter is required/);
    for (const path of ['checklist-blocks?scope=*|*&', 'intake-blocks?scope=*|*&', 'checklist-roles?']) {
      expect(await call('DELETE', `/api/crisis-templates/${path}baseRevision=-1`, 'admin'))
        .toEqual({ status: 400, body: { error: 'baseRevision must be the revision you are resetting (0 for a built-in default)' } });
    }
  });
});

describe('iap resolve (no database)', () => {
  it('requires a session and well-formed ids', async () => {
    expect((await call('GET', '/api/iap/resolve?type=flood')).status).toBe(401);
    expect(await call('GET', '/api/iap/resolve?type=Flood', 'member')).toEqual({ status: 400, body: { error: 'Invalid type' } });
    expect(await call('GET', '/api/iap/resolve?property=a%20b', 'member')).toEqual({ status: 400, body: { error: 'Invalid property' } });
    expect((await call('GET', '/api/iap/resolve?type=a&type=b', 'member')).status).toBe(400);
  });
});

describe('broadcastTemplates', () => {
  it('sends connected editors a templates cue', () => {
    const writes: string[] = [];
    const fake = { write: (s: string) => { writes.push(s); return true; } } as unknown as ExpressResponse;
    const broken = { write: () => { throw new Error('gone'); } } as unknown as ExpressResponse;
    incidentSseClients.add(broken);
    incidentSseClients.add(fake);
    try {
      broadcastTemplates();
    } finally {
      incidentSseClients.delete(fake);
      incidentSseClients.delete(broken);
    }
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^event: templates\ndata: \{"at":"\d{4}-\d\d-\d\dT[^"]+"\}\n\n$/);
  });
});
