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

    await client.query('COMMIT');
    console.log('[migrate] schema up to date');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
