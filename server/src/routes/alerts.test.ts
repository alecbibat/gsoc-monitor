import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import alertsRouter from './alerts';

describe('alerts proxy', () => {
  const realFetch = globalThis.fetch;
  let server: Server;
  let base = '';
  const seen: Array<{ url: string; ua: string | null; accept: string | null }> = [];
  let upstream: (url: URL) => Response = () => new Response('{}');

  beforeAll(async () => {
    const app = express();
    app.use('/api/alerts', alertsRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/alerts/active`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => {
    seen.length = 0;
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === '127.0.0.1') return realFetch(input, init);
      const h = new Headers(init?.headers);
      seen.push({ url: String(input), ua: h.get('user-agent'), accept: h.get('accept') });
      return upstream(url);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const collection = (ids: string[]) =>
    new Response(JSON.stringify({ type: 'FeatureCollection', features: ids.map((id) => ({ id, properties: { event: 'Flood Warning' } })) }), {
      headers: { 'content-type': 'application/geo+json' },
    });

  it('rejects a malformed or out-of-range point with a 400, without calling NWS', async () => {
    for (const q of [
      'point=',
      'point=38.1',
      'point=38.1,-90.2,1',
      'point=38.12345,-90.2', // NWS takes 4 decimals at most
      'point=91,0',
      'point=0,181',
      'point=-90.5,10',
      'point=38.1,%20-90.2',
      'point=38.1,-90.2&point=39,-91',
      'point=abc,def',
    ]) {
      const res = await realFetch(`${base}?${q}`);
      expect(res.status, q).toBe(400);
    }
    expect(seen).toHaveLength(0);
  });

  it('asks NWS for the alerts at the point, identified, and caches them per point', async () => {
    upstream = () => collection(['urn:a']);
    const res = await realFetch(`${base}?point=38.6270,-90.1994`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.json()).toMatchObject({ features: [{ id: 'urn:a' }] });
    expect(seen).toEqual([
      { url: 'https://api.weather.gov/alerts/active?point=38.6270,-90.1994', ua: expect.any(String), accept: 'application/geo+json' },
    ]);
    expect(seen[0].ua).toBeTruthy();

    // Same point: cached. Another point: its own call.
    await realFetch(`${base}?point=38.6270,-90.1994`);
    expect(seen).toHaveLength(1);
    upstream = () => collection(['urn:b']);
    expect(await (await realFetch(`${base}?point=-14.2,-170.7`)).json()).toMatchObject({ features: [{ id: 'urn:b' }] });
    expect(seen.map((s) => s.url)).toEqual([
      'https://api.weather.gov/alerts/active?point=38.6270,-90.1994',
      'https://api.weather.gov/alerts/active?point=-14.2,-170.7',
    ]);
  });

  it('502s a point NWS will not answer', async () => {
    upstream = () => new Response('{"title":"Bad Request"}', { status: 400 });
    const res = await realFetch(`${base}?point=45,-120`);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'Failed to fetch NWS alerts' });
  });

  it('serves a cached point answer through a failure only inside the 60 s TTL, then 502s', async () => {
    upstream = () => collection(['urn:site']);
    const url = `${base}?point=35.1,-89.9`;
    expect((await realFetch(url)).status).toBe(200);

    upstream = () => new Response('Service Unavailable', { status: 503 });
    const cached = await realFetch(url);
    expect(cached.status).toBe(200);
    expect(await cached.json()).toMatchObject({ features: [{ id: 'urn:site' }] });
    expect(seen).toHaveLength(1);

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 61_000);
      // Past the TTL the old answer is no longer the site's current status:
      // 502, so the client takes its caveated county-outline path.
      const expired = await realFetch(url);
      expect(expired.status).toBe(502);
      const body = await expired.json();
      expect(body).toMatchObject({ error: 'Failed to fetch NWS alerts' });
      expect(body).not.toHaveProperty('features');
      expect(seen).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the national feed on its own path and cache key', async () => {
    upstream = () => collection(['urn:national']);
    const res = await realFetch(base);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ features: [{ id: 'urn:national' }] });
    expect(seen.map((s) => s.url)).toEqual(['https://api.weather.gov/alerts/active']);
  });

  it('still degrades the national feed to its last good copy when NWS fails', async () => {
    upstream = () => collection(['urn:national-old']);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 10 * 60_000); // past any earlier test's entry
      expect((await realFetch(base)).status).toBe(200);
      upstream = () => new Response('Service Unavailable', { status: 503 });
      vi.setSystemTime(Date.now() + 61_000);
      const res = await realFetch(base);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ features: [{ id: 'urn:national-old' }] });
      expect(seen).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
