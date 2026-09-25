import { Response } from 'express';

// ── Editors' live-sync fanout ────────────────────────────────────────────────
// The SSE client set for /api/incidents/events, extracted from incidents.ts so
// routes outside that router (the public share-side checklist toggle in
// crisis.ts, the admin template editor in crisisTemplates.ts) can broadcast to
// connected editors without a circular import (incidents.ts already imports
// from crisis.ts).
// Connections are per-process and transient; incident state lives in the DB.

export const incidentSseClients = new Set<Response>();

function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of incidentSseClients) {
    try { client.write(payload); } catch { /* disconnected — cleaned up on close */ }
  }
}

export function broadcastIncident(event: 'upsert' | 'delete', data: unknown): void {
  broadcast(event, data);
}

/**
 * An admin changed the crisis templates (checklists, intake, roles). Carries
 * no config — it can be large and every editor already has a fetch path with
 * its own error handling — just the cue to refetch GET /api/crisis-templates.
 */
export function broadcastTemplates(): void {
  broadcast('templates', { at: new Date().toISOString() });
}
