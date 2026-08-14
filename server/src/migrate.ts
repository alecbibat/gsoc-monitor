import { pool } from './db';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 — avoids visual ambiguity
function randomCode(len = 8) {
  return Array.from({ length: len }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
}

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      -- Team members
      CREATE TABLE IF NOT EXISTS users (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        email        TEXT        UNIQUE NOT NULL,
        name         TEXT        NOT NULL,
        password_hash TEXT       NOT NULL,
        role         TEXT        NOT NULL DEFAULT 'member',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- App-wide key/value config (signup code, etc.)
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Incidents stored as JSONB so the existing Incident shape maps 1:1.
      -- Images are Cloudinary URLs once the client uploads them; no base64.
      CREATE TABLE IF NOT EXISTS incidents (
        id         TEXT        PRIMARY KEY,
        data       JSONB       NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Share link snapshots. Separate from incidents so viewers can access
      -- state by token without auth, and deleting an incident cascades.
      CREATE TABLE IF NOT EXISTS share_links (
        token       TEXT        PRIMARY KEY,
        incident_id TEXT,
        snapshot    JSONB       NOT NULL,
        active      BOOLEAN     NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Viewer password gate for share links (SHA-256 hex of the password).
      -- NULL = legacy link created before passwords existed — stays open.
      ALTER TABLE share_links ADD COLUMN IF NOT EXISTS password_hash TEXT;

      -- Share-link lifecycle (W4): default TTL, audience label, revocation
      -- stamp. Links must not outlive an incident just because nobody
      -- remembered to stand it down.
      ALTER TABLE share_links ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
      ALTER TABLE share_links ADD COLUMN IF NOT EXISTS label      TEXT;
      ALTER TABLE share_links ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

      -- Who opened each share link, and when — a security control, and the
      -- AAR's "did the right people actually see the picture" metric.
      CREATE TABLE IF NOT EXISTS share_access_log (
        id         BIGSERIAL   PRIMARY KEY,
        token      TEXT        NOT NULL,
        at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ip         TEXT,
        user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS share_access_log_token_idx
        ON share_access_log (token, at DESC);

      -- Team-shared OSINT watchlist. Each row is one intel source (news site,
      -- Google-News topic, scanner agency, crime dataset, social account) the
      -- background ingest engine polls. Items themselves are never stored — they
      -- live in an in-memory rolling buffer — so only the sources persist here.
      CREATE TABLE IF NOT EXISTS watchlist_sources (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        kind       TEXT        NOT NULL,
        url        TEXT,
        label      TEXT        NOT NULL,
        config     JSONB       NOT NULL DEFAULT '{}'::jsonb,
        active     BOOLEAN     NOT NULL DEFAULT TRUE,
        added_by   UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Lightning strike history, persisted in ~5-minute append-only chunks so
      -- the 24h buffer survives deploys and dyno restarts (the dyno filesystem
      -- is wiped on both). data = gzip(Float32 lat[] · Float32 lon[] · Uint32
      -- tSec[]), ~30-60 KB per chunk, ~290 rows/day; rows older than the window
      -- are pruned on each save.
      CREATE TABLE IF NOT EXISTS lightning_chunks (
        id          BIGSERIAL   PRIMARY KEY,
        chunk_start BIGINT      NOT NULL,
        n           INTEGER     NOT NULL,
        data        BYTEA       NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Small key/value snapshots for layers whose latest state should survive
      -- deploys (the dyno filesystem is wiped on every deploy/restart). First
      -- user: the wind grid (~80 KB JSONB, upserted after each live fetch).
      CREATE TABLE IF NOT EXISTS snapshots (
        key        TEXT        PRIMARY KEY,
        data       JSONB       NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Signup code. If SIGNUP_CODE is set in the environment it is authoritative
    // and re-applied on every boot — this guarantees the operator always knows
    // the code, even on hosts where reading startup logs is awkward. (Remove the
    // env var later if you'd rather the admin panel's "refresh" persist across
    // deploys.) If SIGNUP_CODE is unset, seed a random code once and log it.
    const envCode = process.env.SIGNUP_CODE?.trim().toUpperCase();
    if (envCode) {
      await client.query(
        `INSERT INTO settings (key, value) VALUES ('signup_code', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [envCode]
      );
      console.log('[migrate] signup code applied from SIGNUP_CODE env var');
    } else {
      const { rows } = await client.query("SELECT value FROM settings WHERE key = 'signup_code'");
      if (rows.length === 0) {
        const code = randomCode();
        await client.query(
          "INSERT INTO settings (key, value) VALUES ('signup_code', $1) ON CONFLICT DO NOTHING",
          [code]
        );
        console.log(`[migrate] initial signup code: ${code}`);
      }
    }

    // Sunset pre-W4 links (including legacy passwordless ones, which are open
    // to anyone holding the URL): give them one 72h grace window from this
    // deploy. Only NULL rows are touched, so re-running never extends anything.
    await client.query(`
      UPDATE share_links SET expires_at = NOW() + interval '72 hours'
      WHERE expires_at IS NULL AND active = TRUE
    `);

    await client.query('COMMIT');
    console.log('[migrate] schema up to date');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
