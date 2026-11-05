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

  describe('what became of an alert', () => {
    const fate = () => base.replace(/\/active$/, '/fate');
    const ID = (hex: string) => `urn:oid:2.49.0.1.840.0.${hex.repeat(40 / hex.length)}.001.1`;
    const record = (props: Record<string, unknown>) =>
      new Response(JSON.stringify({ properties: props }), { headers: { 'content-type': 'application/geo+json' } });

    it('rejects anything but an NWS alert id, without calling NWS', async () => {
      for (const q of ['', 'id=', 'id=abc', `id=${ID('ab')}x`, `id=${encodeURIComponent('https://evil.example/x')}`, 'id=urn:oid:2.49.0.1.840.0../..001.1']) {
        expect((await realFetch(`${fate()}?${q}`)).status, q).toBe(400);
      }
      expect(seen).toHaveLength(0);
    });

    it('says an alert was cancelled, with the cancellation', async () => {
      const original = ID('a1');
      const cancel = ID('c1');
      upstream = (url) =>
        url.pathname.endsWith(original)
          ? record({ id: original, messageType: 'Alert', replacedBy: `https://api.weather.gov/alerts/${cancel}` })
          : record({ id: cancel, messageType: 'Cancel', sent: '2026-11-05T14:00:00-05:00', description: 'The Flood Warning has been cancelled.' });
      const res = await realFetch(`${fate()}?id=${original}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        id: original,
        status: 'cancelled',
        by: { id: cancel, sent: '2026-11-05T14:00:00-05:00', description: 'The Flood Warning has been cancelled.' },
      });
      expect(seen.map((s) => s.url)).toEqual([`https://api.weather.gov/alerts/${original}`, `https://api.weather.gov/alerts/${cancel}`]);
    });

    it('tells a replacement by an update, and an alert nothing replaced, from a cancellation', async () => {
      const updated = ID('a2');
      const update = ID('d2');
      upstream = (url) =>
        url.pathname.endsWith(updated)
          ? record({ id: updated, replacedBy: `https://api.weather.gov/alerts/${update}` })
          : record({ id: update, messageType: 'Update' });
      expect(await (await realFetch(`${fate()}?id=${updated}`)).json()).toEqual({ id: updated, status: 'replaced', by: { id: update, messageType: 'Update' } });

      const lone = ID('a3');
      upstream = () => record({ id: lone, messageType: 'Alert' });
      expect(await (await realFetch(`${fate()}?id=${lone}`)).json()).toEqual({ id: lone, status: 'not-replaced' });
    });

    it('never follows a replacedBy that is not one of NWS\'s own alerts', async () => {
      const id = ID('a4');
      upstream = () => record({ id, replacedBy: 'https://evil.example/alerts/x' });
      expect(await (await realFetch(`${fate()}?id=${id}`)).json()).toEqual({ id, status: 'not-replaced' });
      expect(seen.map((s) => s.url)).toEqual([`https://api.weather.gov/alerts/${id}`]);
    });

    it('502s when NWS will not answer', async () => {
      upstream = () => new Response('Service Unavailable', { status: 503 });
      expect((await realFetch(`${fate()}?id=${ID('a5')}`)).status).toBe(502);
    });
  });
});
