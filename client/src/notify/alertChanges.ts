// ── What changed in an alert ─────────────────────────────────────────────────
// An NWS alert or a WEA that changes arrives as a new message that replaces
// the earlier one. Which of those are news? Not every one: the NWS re-issues
// each long-running alert every few hours with nothing changed (VTEC "CON"),
// and every re-issue carries a new message expiry and headline, usually
// reworded text, and — once the hazard is under way — an onset reset to the
// issue time. What the NWS does change when a hazard changes is the alert
// type (a watch upgraded to a warning), its severity or certainty, and the
// hazard's start or end time. So those are compared; the wording is not.
// A WEA is only re-sent to phones when something is meant to change, so its
// message, recommended action and expiry all count. Pure: no store, no fetch.

import type { RawAlert } from '../layers/alerts/alertsData';
import type { WarnAlert } from '../types';

/** One thing that differs between two versions of an alert, for the card. */
export interface AlertChange {
  label: string;
  from: string | null;
  to: string | null;
  /** 'time': ISO instants the card formats as times; 'text': shown as is. */
  kind: 'time' | 'text';
}

const squash = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const nonEmpty = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

function instant(iso: string | null | undefined): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
}

/** The same moment (to the minute), or both unset — however the offsets are written. */
function sameInstant(a: string | null, b: string | null): boolean {
  const ta = instant(a);
  const tb = instant(b);
  if (ta === null || tb === null) return ta === tb;
  return Math.abs(ta - tb) < 60_000;
}

function textChange(label: string, from: string | null, to: string | null): AlertChange[] {
  return squash(from) === squash(to) ? [] : [{ label, from: nonEmpty(from), to: nonEmpty(to), kind: 'text' }];
}

// ── NWS ──────────────────────────────────────────────────────────────────────

/** What about an NWS alert can change and be news. */
export interface NwsFacts {
  event: string | null;
  severity: string | null;
  certainty: string | null;
  /** When the hazard begins (for one under way, NWS restates it as the issue time). */
  onset: string | null;
  /** When the hazard ends; null = not given (until further notice). */
  ends: string | null;
  /** When this version was issued. */
  sent: string | null;
}

export function nwsFacts(a: RawAlert): NwsFacts {
  const p = a.properties;
  return {
    event: nonEmpty(p.event),
    severity: nonEmpty(p.severity),
    certainty: nonEmpty(p.certainty),
    onset: nonEmpty(p.onset),
    ends: nonEmpty(p.ends),
    sent: nonEmpty(p.sent),
  };
}

/** What changed from one version of an NWS alert to the next; empty for a re-issue. */
export function nwsChanges(prior: NwsFacts, next: NwsFacts): AlertChange[] {
  const changes = [
    ...textChange('Alert', prior.event, next.event),
    ...textChange('Severity', prior.severity, next.severity),
    ...textChange('Certainty', prior.certainty, next.certainty),
  ];
  // The start only counts while the hazard hadn't begun when this version
  // went out; after that, NWS restates it as each re-issue's issue time.
  const priorStart = instant(prior.onset);
  const sent = instant(next.sent);
  if (priorStart !== null && sent !== null && priorStart > sent + 60_000 && !sameInstant(prior.onset, next.onset)) {
    changes.push({ label: 'Starts', from: prior.onset, to: next.onset, kind: 'time' });
  }
  if (!sameInstant(prior.ends, next.ends)) changes.push({ label: 'Ends', from: prior.ends, to: next.ends, kind: 'time' });
  return changes;
}

// ── Wireless Emergency Alerts ────────────────────────────────────────────────

/** What about a WEA can change and be news. */
export interface WeaFacts {
  event: string | null;
  severity: string | null;
  certainty: string | null;
  urgency: string | null;
  /** The recommended action: Shelter, Evacuate, … AllClear. */
  responseType: string | null;
  text: string | null;
  longText: string | null;
  expires: string | null;
}

export function weaFacts(a: WarnAlert): WeaFacts {
  return {
    event: nonEmpty(a.event),
    severity: nonEmpty(a.severity),
    certainty: nonEmpty(a.certainty),
    urgency: nonEmpty(a.urgency),
    responseType: nonEmpty(a.responseType),
    text: nonEmpty(a.weaText),
    longText: nonEmpty(a.weaLongText),
    expires: nonEmpty(a.expires),
  };
}

/** What changed from one version of a WEA to the next; empty when it was re-sent as it was. */
export function weaChanges(prior: WeaFacts, next: WeaFacts): AlertChange[] {
  const message = textChange('Message', prior.text, next.text);
  return [
    ...textChange('Alert', prior.event, next.event),
    ...textChange('Action', prior.responseType, next.responseType),
    ...textChange('Severity', prior.severity, next.severity),
    ...textChange('Certainty', prior.certainty, next.certainty),
    ...textChange('Urgency', prior.urgency, next.urgency),
    // The longer message (360 characters, newer phones) when the short one held.
    ...(message.length > 0 ? message : textChange('Message', prior.longText, next.longText)),
    ...(sameInstant(prior.expires, next.expires) ? [] : [{ label: 'Expires', from: prior.expires, to: next.expires, kind: 'time' as const }]),
  ];
}
