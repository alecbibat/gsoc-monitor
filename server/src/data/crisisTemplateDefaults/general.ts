// General scope — applies to EVERY incident, whatever its type or property.
//
// LEGACY_GENERAL_CHECKLIST (legacy.ts) is prepended to GENERAL_CHECKLIST
// automatically, so this list only holds what those items do not cover:
//   - generic replacements for the vessel-only legacy items that moved to the
//     Maritime type (confirm the report, notifications, size-up, hazard
//     assessment, PPE, accountability, immediate resources, procurement …),
//   - the GSOC Support position's full checklist (all three phases),
//   - a few hospitality-wide items every incident needs (guest-facing
//     messaging, relocation, cost code, damage documentation).
//
// GENERAL_INTAKE embeds all five LEGACY_GENERAL_INTAKE questions (ids iq-6,
// iq-7, iq-8, iq-11, iq-23) verbatim so existing incidents keep their answers.
//
// Ids are minted from position (helpers.ts): append new lines at the END of a
// list — never reorder or delete published lines.

import type { ChecklistBlockItem, IntakeBlockGroup } from '../../crisisTemplates/types';
import { checklistItems, intakeGroupMixed } from './helpers';
import { LEGACY_GENERAL_INTAKE as L } from './legacy';

export const GENERAL_CHECKLIST: ChecklistBlockItem[] = checklistItems('g', {
  ic: {
    immediate: [
      'Confirm the report: what happened, exact location, time, who is involved, and that life-safety accounting is underway.',
      'Verify emergency notifications: 911/local emergency services, property General Manager, GSOC, and corporate risk/legal as required.',
      'Conduct a rapid size-up: casualties, active hazards, people and areas affected, and how the incident is likely to develop.',
      'Confirm protective actions (evacuate, shelter in place, lock down, or close the area) are ordered and announced where needed.',
      'Designate a GSOC point of contact and set the situation-update cadence (e.g., every 30 minutes while Active).',
      'Decide whether to activate the corporate crisis management team and brief executive leadership per the escalation matrix.',
    ],
    ongoing: [
      'Approve resource requests and external assistance (contractors, mutual aid, specialized response) before they are committed.',
      'Reassess incident status (Monitoring / Active / Recovery) each operational period and have GSOC update it in the tool.',
      'Brief executive leadership on objectives, key decisions, and outstanding risks on the agreed cadence.',
    ],
    demob: [
      'Confirm stand-down criteria are met and direct GSOC to move the incident to Recovery or stand it down in the tool.',
      'Schedule a hot wash within 72 hours and assign owners and due dates for corrective actions.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Open the incident in the tool: set name, incident type, property, location pin, and status (Active or Monitoring).',
      'Start the Action Log with the initial report: source, time received, and the facts confirmed so far.',
      'Notify on-call leadership and the crisis management team per the escalation matrix; log each contact, time, and method.',
      'Enable map layers relevant to the hazard (e.g., NWS alerts, radar, wildfires, earthquakes, power outages) and check Property Watch.',
      'Check OSINT/news and live feeds to corroborate the report; flag conflicting information to the IC.',
      'Pull a list of guests, employees, and travelers in or bound for the affected area (in-house, arriving, on tour, at sea).',
      'Open an incident bridge or chat channel with the on-scene lead and confirm a backup contact method.',
    ],
    ongoing: [
      'Monitor enabled layers and OSINT continuously; log significant changes (new warnings, perimeter growth, outages) with time and source.',
      'Keep the Executive Summary current after each briefing or significant change.',
      'Publish share links with a clear audience label and expiry; extend or revoke them as audiences change.',
      'Track the status of affected guests, staff, and travelers (accounted for, injured, relocated, departed) and report changes to Planning.',
      'Distribute situation updates to the notification list on the IC\'s cadence and log each distribution.',
      'Watch for secondary hazards (new alerts, aftershocks, road closures, outages) near the incident and other properties; alert the affected GMs.',
      'Keep intake answers and ICS role assignments in the tool current as information and staffing change.',
      'Give incoming GSOC operators a handover briefing: status, open actions, pending notifications, and active share links.',
    ],
    demob: [
      'Revoke every active share link for the incident (or confirm it has expired) and log the revocation.',
      'Send the stand-down notification to everyone on the notification list, with follow-up contacts.',
      'Review the Action Log and timeline for gaps, then generate the After-Action Report and note GSOC lessons learned.',
      'Stand the incident down in the tool to archive the record, and return layers and Property Watch to routine monitoring.',
    ],
  },
  safety: {
    immediate: [
      'Conduct an initial hazard assessment of the scene: fire/smoke, structural damage, utilities, weather, violence, and access/egress.',
      'Confirm responders wear PPE appropriate to the hazard (hi-vis, gloves, eye and respiratory protection) before entering work areas.',
      'Verify evacuation routes, exits, and assembly points are clear, lit, and located away from the hazard.',
      'Recommend an exclusion perimeter and keep guests and non-essential staff out until the area is assessed safe.',
    ],
    ongoing: [
      'Monitor tactical, cleanup, and repair work for safe practices and correct deviations on the spot.',
      'Track responder fatigue, work/rest cycles, heat or cold stress, and changing weather each operational period.',
      'Ensure only trained staff perform hazardous tasks; hand specialized work to qualified responders or contractors.',
    ],
  },
  pio: {
    immediate: [
      'Coordinate guest-facing messaging with the property GM (front desk scripts, PA/in-room notices, signage) so guests hear one message.',
      'Send employees an internal holding message: what happened, what to do, and not to speak to media or post on social media.',
    ],
    ongoing: [
      'Give front desk, reservations, and call-center staff an approved FAQ and update it with each release.',
      'Align messaging for arriving and booked guests (changes, cancellations, refunds) with reservations and get IC approval.',
    ],
  },
  liaison: {
    immediate: [
      'Identify assisting and cooperating agencies: fire/EMS, law enforcement, emergency management, land-management agency, utilities.',
    ],
    ongoing: [
      'Track agency EOC activations and coordination calls; attend or assign a company representative and share notes with GSOC.',
      'Make notifications required by contracts, concession agreements, or leases, and log who was told and when.',
    ],
  },
  ops: {
    immediate: [
      'Obtain a situation brief from the on-scene lead (manager on duty, security, or first responders) and set tactical priorities.',
      'Account for all guests, employees, and contractors using registers, rosters, and assembly-point checks; report gaps immediately.',
      'Assess whether the affected area can stay occupied or needs evacuation, shelter-in-place, or closure; recommend to the IC.',
      'Isolate the hazard area: set a perimeter, control access, and keep guests clear of emergency-vehicle routes.',
    ],
    ongoing: [
      'Coordinate guest relocation (alternate rooms, sister properties, or reception sites) and record who moved where.',
      'Decide which guest services, activities, and tours to suspend; tell the front desk and GSOC about each closure.',
    ],
    demob: [
      'Confirm the scene is secured and all persons are safe before reducing tactical resources.',
      'Walk affected areas with Safety and Engineering before returning them to guest use.',
    ],
  },
  planning: {
    immediate: [
      'Collect and display situation information: location, weather, casualties, affected properties and guests, and access routes.',
    ],
    ongoing: [
      'Maintain the common operating picture: situation status, map layers with drawn perimeters/hazards, and key facts in the Situation Report.',
      'Prepare contingency plans for the most likely worsening scenarios (escalation, weather change, full evacuation, prolonged closure).',
      'Forecast business impacts for the next 24-72 hours: arrivals, occupancy, closures, and staff availability.',
    ],
  },
  logistics: {
    immediate: [
      'Identify immediate resource needs: medical supplies, lighting, generators, radios, vehicles, PPE, and drinking water.',
      'Arrange transport and a reception location for evacuated or relocated guests and staff.',
    ],
    ongoing: [
      'Confirm backup power, fuel, water, and IT/network continuity for the ICP and critical property systems.',
      'Line up restoration, security, and equipment-rental vendors through Finance so they can deploy on request.',
    ],
  },
  finance: {
    immediate: [
      'Stand ready to authorize emergency procurement (contractors, equipment, lodging, transport) within delegated limits.',
      'Open an incident cost code and share it with every section and property involved.',
    ],
    ongoing: [
      'Track guest refunds, comps, rebooking, and cancellation costs separately from response costs.',
      'Document property damage with dated photos and video before cleanup or repair begins, for insurance claims.',
      'Track business-interruption impacts (lost room nights, cancelled tours or sailings, closed outlets) for insurers.',
    ],
  },
});

export const GENERAL_INTAKE: IntakeBlockGroup[] = [
  intakeGroupMixed('g-reporter', 'Reporter & Contact', [
    'Who is reporting (name, role/title, and property or department)?',
    'How was the incident learned of — direct observation, guest, staff, agency, or media report?',
    L['iq-6'],
    'Is the reporter on scene now, and can they safely stay there to provide updates?',
  ]),
  intakeGroupMixed('g-situation', 'What, Where & When', [
    'What happened? Describe the incident in your own words.',
    'Exactly where is it — property, building, floor/room, trail, road, or nearest landmark (coordinates if known)?',
    'When did it happen or when was it first observed (local time)?',
    'Is the situation still ongoing, growing, or contained?',
    'Are roads, entrances, and access routes to the scene open for responders?',
  ]),
  intakeGroupMixed('g-life-safety', 'Life Safety', [
    'Is anyone in immediate danger right now?',
    L['iq-7'],
    L['iq-11'],
    L['iq-8'],
    'Has 911 / local emergency services been called? Are EMS, fire, or police on scene or en route?',
    'Has an evacuation, shelter-in-place, or lockdown been ordered? For which areas?',
  ]),
  intakeGroupMixed('g-people-ops', 'Guests, Staff & Operations', [
    'Approximately how many guests are affected or in the affected area?',
    'How many employees and contractors are affected or on duty in the area?',
    L['iq-23'],
    'Are any guests or staff with special needs involved (mobility, medical, minors, language)?',
    'Which operations are affected (lodging, dining, tours, transportation, sailings, events)? Are any closed?',
    'Is there damage to buildings, utilities (power, water, gas), or phones/IT?',
  ]),
  intakeGroupMixed('g-actions', 'Actions & Notifications', [
    'What actions have been taken so far, and by whom?',
    'Who has been notified — 911, property General Manager, land-management agency (e.g., NPS), law enforcement, corporate?',
    'Are media or bystanders present, or is the incident being discussed on social media?',
    'What immediate help or resources are needed from GSOC or corporate?',
  ]),
];
