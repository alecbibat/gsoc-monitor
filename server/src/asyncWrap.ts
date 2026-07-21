import type { Request, Response } from 'express';

/**
 * Express 4 does not catch rejected async handlers: a thrown DB error (e.g.
 * Postgres down — the exact degraded mode the server is designed to ride out)
 * would otherwise produce no response at all and the client hangs until the
 * router's 30s timeout. Wrap DB-backed handlers so failures answer 503 fast.
 */
export function wrap(fn: (req: Request, res: Response) => Promise<void>, tag = 'api') {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error(`[${tag}]`, err instanceof Error ? err.message : err);
      if (!res.headersSent) res.status(503).json({ error: 'Service temporarily unavailable' });
    });
  };
}
