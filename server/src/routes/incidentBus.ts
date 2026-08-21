import { Response } from 'express';

// ── Editors' live-sync fanout ────────────────────────────────────────────────
// The SSE client set for /api/incidents/events, extracted from incidents.ts so
// routes outside that router (the public share-side checklist toggle in
// crisis.ts) can broadcast incident changes to connected editors without a
// circular import (incidents.ts already imports from crisis.ts).
// Connections are per-process and transient; incident state lives in the DB.

export const incidentSseClients = new Set<Response>();

export function broadcastIncident(event: 'upsert' | 'delete', data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of incidentSseClients) {
    try { client.write(payload); } catch { /* disconnected — cleaned up on close */ }
  }
}
