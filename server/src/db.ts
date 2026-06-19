import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

// Decide SSL by host, not NODE_ENV. A managed database (Heroku Postgres) needs
// SSL and refuses plaintext connections; keying off NODE_ENV meant an unset or
// non-"production" value silently turned SSL off, so every connection failed at
// boot. Enable SSL for any remote host and disable it only for local Postgres.
const isLocalDb =
  !connectionString || /@(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/.test(connectionString);

export const pool = new Pool({
  connectionString,
  // Heroku Postgres certs are signed by an internal CA not in the default
  // bundle, so rejectUnauthorized must be false for the handshake to complete.
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[db] idle client error:', err);
});
