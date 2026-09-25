// Incident-type scope defaults — Security (violence / threat, suspicious
// activity, theft / loss prevention, civil unrest).
//
// Only what is specific to the security incident lives here; generic ICS
// duties are in the General scope and property specifics in properties.ts.
// Guiding principles for every list below:
//   - law enforcement leads any tactical response; the company supports it,
//     protects people, preserves evidence and looks after guests and staff,
//   - GSOC does the watching (Intel Feed scanner/crime/social, News, Property
//     Watch, Flights, Ships (AIS)), keeps the BOLO and evidence trail, and
//     keeps sensitive details out of broadly shared views,
//   - tour groups (Holiday Vacations, VBT) and ship port calls (Windstar) are
//     exposed to unrest far from any owned property.
//
// Ids are minted from list positions (see helpers.ts): once published, append
// new lines at the END of a list — never reorder or delete lines.

import type { ChecklistBlockItem, IntakeBlockGroup } from '../../crisisTemplates/types';
import { checklistItems, intakeGroup } from './helpers';

// ── Violence / Threat ────────────────────────────────────────────────────────

const VIOLENCE_THREAT = checklistItems('t-violence-threat', {
  ic: {
    immediate: [
      'Defer all tactical decisions to law enforcement and keep lockdown in place until police declare the scene secure; the company supports, it does not lead.',
      'For a bomb threat, decide with police whether to search, evacuate or both, and use only exits and assembly points that have been swept.',
    ],
    ongoing: [
      'Convene the threat assessment team (security, HR, legal) when the subject is known or at large, and approve protective measures for anyone targeted.',
    ],
    demob: [
      'Keep the heightened security posture until the subject is in custody or the threat assessment team rates the ongoing risk as low.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Send the lockdown / avoid-the-area alert to staff at the property and nearby sites by mass notification; log delivery and replies.',
      'Turn on the Intel Feed (Scanner, Social) and News around the property; log police-radio and social reports and flag unverified claims.',
      'Preserve CCTV for the affected areas: export clips, suspend overwrite, and note camera IDs and clock offsets for investigators.',
      'For a phoned or written threat, record the exact wording, caller ID, time, voice and background noise on the bomb-threat checklist for police.',
    ],
    ongoing: [
      'Maintain the BOLO (photo, description, weapon, vehicle, plate, last seen, direction) and push each update to the on-scene lead and sister properties.',
      "Run protective-intelligence searches on the subject's name, handles and grievance; report any new threat, target, or plan to travel to a site.",
      'Keep victim names, suspect details and tactical information out of the Executive Summary, and limit share links to need-to-know audiences.',
    ],
    demob: [
      'Monitor OSINT and social media for copycat or renewed threats, including around court dates, for at least 30 days after the incident.',
    ],
  },
  safety: {
    immediate: [
      'Brief staff on Run-Hide-Fight: no employee confronts, pursues or detains an armed subject, and no one re-enters until police clear the area.',
    ],
    ongoing: [
      'Arrange critical incident stress support (EAP counselors) for witnesses, responders and co-workers before they go off shift.',
    ],
  },
  pio: {
    immediate: [
      'Refer questions on suspects, victims, motive and casualties to the lead police agency, align each release with its PIO, and release no names.',
      'Pause scheduled marketing emails and social posts for the property and brand until the IC clears them.',
    ],
  },
  liaison: {
    immediate: [
      'Give responding police floor plans, master keys or access cards, camera locations, and a staff guide who knows the building.',
    ],
    ongoing: [
      'Obtain the police case number and investigating agency contact, and confirm when witnesses may leave and when the scene will be released.',
    ],
  },
  ops: {
    immediate: [
      'Lock doors near the threat, move guests into rooms or lockable spaces away from windows and doors, and hold arrivals and deliveries.',
    ],
    ongoing: [
      'Run a reunification point away from the scene and media; check people against registers and release them only after police take witness details.',
    ],
  },
  planning: {
    ongoing: [
      'Build a minute-by-minute timeline from CCTV, access-control logs, radio traffic and 911 call times for police and the after-action review.',
    ],
  },
  logistics: {
    ongoing: [
      'Arrange additional security officers or off-duty police details through the security vendor for the coming operational periods.',
    ],
  },
  finance: {
    ongoing: [
      'Notify the insurer or broker under the workplace-violence / active-assailant coverage and track security surge and counseling costs.',
    ],
  },
});

const VIOLENCE_THREAT_INTAKE = [
  intakeGroup('t-violence-threat', 'Threat & Subject', [
    'What kind of threat is it — active assailant, assault, verbal or written threat, bomb threat, domestic dispute, or other?',
    'Is a weapon involved or claimed? What kind, and has it been used?',
    'Describe each subject: number, sex, build, clothing, distinguishing features, and any vehicle and plate.',
    'Where and when was the subject last seen, and which way were they heading?',
    'Is the subject known to the company (current or former employee, guest, partner of an employee)? Who or what is the target?',
  ]),
  intakeGroup('t-violence-threat-response', 'Police Response & Protective Actions', [
    'Are police on scene or en route? Which agency, and is there a case or incident number yet?',
    'Has a Run-Hide-Fight or lockdown message reached guests and staff, and by what means (PA, mass notification, radio, room phones)?',
    'For a phoned, written or online threat: what were the exact words, when was it received, and how was it delivered?',
  ]),
];

// ── Suspicious Activity ──────────────────────────────────────────────────────

const SUSPICIOUS_ACTIVITY = checklistItems('t-suspicious-activity', {
  ic: {
    immediate: [
      'Treat a suspicious package as a possible explosive until bomb-squad clearance, and decide evacuation with police using standoff distances.',
      'Decide whether to raise the security posture (extra patrols, controlled entrances, closed back-of-house doors) while the activity is assessed.',
    ],
    demob: [
      'Close the incident only when police clear the item or person or the activity is explained; record the outcome and who confirmed it.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Track the person, vehicle or item on live and recorded CCTV; export clips and stills with camera IDs and timestamps.',
      'Search the Intel Feed (Crime, Scanner), News and past incidents in the tool for similar reports near the property or other company sites in the last 30 days.',
      'For a drone or low aircraft, log time, direction, altitude and operator location, and check Flights for aircraft near the property.',
    ],
    ongoing: [
      'Log the report in the suspicious-activity register and link earlier reports of the same person, vehicle or plate across properties.',
      'Send a BOLO (description, stills, vehicle, plate) to property security and front desks, and to nearby sister properties if relevant.',
    ],
    demob: [
      'Add confirmed subjects or vehicles to the property trespass / watch list with a review date, and note the list entry in the Action Log.',
    ],
  },
  safety: {
    immediate: [
      'Do not touch, move or cover a suspicious item; switch off radios and cell phones near it and use landlines or runners instead.',
      'Clear people per the DHS bomb-threat standoff chart (suitcase-size: evacuate at least 150 ft; shelter indoors or move beyond 1,850 ft) until police direct.',
    ],
  },
  pio: {
    ongoing: [
      'Make no public comment unless guests saw the response; if asked, say police were called as a precaution and operations continue.',
    ],
  },
  liaison: {
    immediate: [
      'Report the activity to local police with the description, location and CCTV availability; request a patrol check or bomb squad as needed.',
    ],
    ongoing: [
      'When the behavior matches suspicious activity reporting (SAR) indicators, confirm police have shared it with the state fusion center.',
    ],
  },
  ops: {
    immediate: [
      'Ask front desk, bell staff and housekeeping whether the item or person is known (lost luggage, vendor, expected guest) before escalating.',
      'Have a security officer or manager observe the person or vehicle from a distance without confronting them, updating GSOC throughout.',
      'Tighten access control: lock non-essential doors, check credentials at back-of-house entrances, and staff the main entrance.',
    ],
  },
  planning: {
    ongoing: [
      'Record observed behavior, times and locations only; do not base reports on race, ethnicity, religion or appearance.',
    ],
  },
});

const SUSPICIOUS_ACTIVITY_INTAKE = [
  intakeGroup('t-suspicious-activity', 'Activity & Description', [
    'What exactly was observed — a person, vehicle, drone, unattended item, attempted access, or unusual interest in security?',
    'Describe the person or vehicle: clothing, build, items carried, make, model, color, plate, and direction of travel.',
    'Where and when was it seen, and is the person, vehicle or item still there now?',
    'Was anyone photographing, measuring, or asking about security, staffing, or access? What exactly was said or done?',
    'Is there CCTV coverage of the location and time, and has the footage been saved?',
  ]),
  intakeGroup('t-suspicious-activity-item', 'Unattended Item', [
    'What does the item look like (size, type, wires, odor, liquid, labels), and has anyone touched or moved it?',
    'Has the area around the item been cleared? How far back are people now?',
    'Is anything else unusual present — a second item, a threatening call, or a vehicle parked in an odd spot?',
  ]),
];

// ── Theft / Loss Prevention ──────────────────────────────────────────────────

const THEFT = checklistItems('t-theft', {
  ic: {
    immediate: [
      'Decide whether the theft points to ongoing risk (compromised key or master card, organized crew, insider) that needs immediate security changes.',
    ],
    ongoing: [
      'Involve HR and legal before any employee is questioned, searched, suspended or named in connection with the theft.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Export and preserve CCTV, door-lock and key-card audit trails and POS records for the time window before they overwrite; log who pulled them.',
      'Search the Intel Feed (Crime) and News for similar thefts, vehicle break-ins or crews operating near the property.',
    ],
    ongoing: [
      "Compare the method, suspect and vehicle with other properties' incident logs and alert their security leads if there is a pattern.",
    ],
    demob: [
      'Confirm the police report number, evidence log and final loss total are recorded in the incident before it is archived.',
    ],
  },
  safety: {
    immediate: [
      'Do not let staff chase or physically detain a suspect; observe, describe and report, and let police make any arrest.',
    ],
  },
  pio: {
    ongoing: [
      'Give front desk and managers a short script for guests asking about thefts; never name suspects or discuss employees under investigation.',
    ],
  },
  liaison: {
    immediate: [
      'Have the guest or employee file a police report, or file one for company losses, and record the report number and agency.',
    ],
    ongoing: [
      'Hand police copies of CCTV and access logs on a signed chain-of-custody form, recording what was released, when, and to whom.',
    ],
  },
  ops: {
    immediate: [
      'Secure the scene (room, vehicle, office, storage) and keep housekeeping and maintenance out; do not re-rent a room until released.',
      'Take a written statement: items, serial numbers, value, when last seen, and who had access; photograph any damage or forced entry.',
      'Re-key or re-code affected locks, safes and key cards, and void lost master cards, if a key, card or code may be compromised.',
    ],
    ongoing: [
      'Identify who entered the area in the window (lock audit, housekeeping and maintenance assignments) and share it only with security, HR and police.',
    ],
  },
  planning: {
    ongoing: [
      'Keep an evidence log for every item, recording and document collected: description, collected by, time, storage location and current holder.',
    ],
    demob: [
      'Recommend loss-prevention fixes (camera coverage, key control, in-room safe use, cash handling, bike and vehicle locks) based on how the theft occurred.',
    ],
  },
  logistics: {
    ongoing: [
      'Help affected travelers replace essentials: medication, phone, transport, and passports or visas through the nearest embassy or consulate.',
    ],
  },
  finance: {
    immediate: [
      'Freeze and count affected cash drawers, safes or company cards with a second verifier, and document the loss amount.',
    ],
    ongoing: [
      'Route guest claims to risk management without promising reimbursement on site (innkeeper liability limits may apply); file company losses with the insurer.',
    ],
  },
});

const THEFT_INTAKE = [
  intakeGroup('t-theft', 'Loss Details', [
    'What was taken (description, serial numbers, estimated value), and whose was it — guest, employee, or company?',
    'Where was it taken from (guest room, vehicle, office, safe, bike storage, hangar, vessel) and when was it last seen?',
    'Were there signs of forced entry, or was a key, key card, or code used?',
    'Is the suspect known or described? Is there CCTV, lock-audit, or witness evidence?',
  ]),
  intakeGroup('t-theft-follow-up', 'Reporting & Follow-up', [
    'Has a police report been filed? With which agency, and what is the report number?',
    'Were cards, IDs, passports, keys, or company devices taken that must be cancelled, re-keyed, or remotely locked?',
    'Does the affected person need help with travel documents, medication, transport, or a room change?',
  ]),
];

// ── Civil Unrest ─────────────────────────────────────────────────────────────

const CIVIL_UNREST = checklistItems('t-civil-unrest', {
  ic: {
    immediate: [
      "Set the property's posture (normal, restricted access, early outlet closure, or lockdown) from the protest's size, behavior and route.",
      'Decide whether tours, bike routes, excursions and port calls in the affected area proceed, reroute, or cancel.',
    ],
    ongoing: [
      'Set triggers for relocating guests or ending a trip early: curfew, violence near a route or hotel, advisory upgrade, airport closure.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Map the protest location, march route and police closures from News and the Intel Feed (Social, Scanner); log crowd-size estimates and sources.',
      'List every tour group (Holiday Vacations, VBT) and Windstar port call in the affected city for the next 72 hours and brief the IC.',
    ],
    ongoing: [
      'Track curfews, travel-advisory and embassy-alert changes, and road, airport, rail and port closures; pass each to tour directors and ship ops.',
      'Watch social media for calls to target the company, its brands or properties, or for planned actions at its locations.',
      'Plot each tour group\'s hotel and route and each ship\'s berth (Ships (AIS)) against protest sites and closures; warn any group or ship the unrest nears.',
    ],
    demob: [
      'Keep watching for follow-on protests (verdicts, funerals, elections, anniversaries) in the region before closing the incident.',
    ],
  },
  safety: {
    immediate: [
      'Keep guests and staff away from protests and police lines; brief tour directors to avoid crowds, filming, and political symbols.',
    ],
    ongoing: [
      'If tear gas or smoke is used nearby, close outdoor areas, set HVAC to recirculate, and keep windows and doors shut.',
    ],
  },
  pio: {
    immediate: [
      'Make no comment on the cause or politics of the unrest; limit statements to guest and staff safety measures.',
    ],
    ongoing: [
      'Send traveling guests clear guidance on curfews, areas to avoid, safe routes, and how to reach their tour director or GSOC.',
    ],
  },
  liaison: {
    immediate: [
      'Contact local police or the event commander for expected crowd size, march route, road closures and curfew enforcement.',
    ],
    ongoing: [
      "For groups abroad, urge travelers to enroll in their government's alert program (e.g., the U.S. STEP) and stay in contact with ground operators and hotels.",
    ],
  },
  ops: {
    immediate: [
      'Secure the perimeter: lock secondary entrances, bring in outdoor furniture, signage and valuables, and park vehicles away from the street.',
      'Reroute or hold coaches, shuttles and bike routes around protest areas and closures, and confirm each new route with GSOC.',
    ],
    ongoing: [
      'Get guests and staff back to lodging before curfew, and arrange escorts or company transport for staff commuting through affected areas.',
    ],
  },
  planning: {
    ongoing: [
      'Prepare relocation and early-departure options for groups in the area: alternate hotels, exit routes, and flights.',
    ],
  },
  logistics: {
    ongoing: [
      'Line up board-up and glass-protection vendors, and stock the property for a multi-day disruption (food, water, fuel, cash).',
    ],
  },
  finance: {
    ongoing: [
      'Track reroute, early-departure, extra-night and security costs, and check travel-insurance and force-majeure terms with legal.',
    ],
  },
});

const CIVIL_UNREST_INTAKE = [
  intakeGroup('t-civil-unrest', 'Protest & Location', [
    'Where is the protest or unrest, how close is it to the property, route or port, and which way is it moving?',
    'How many people are involved, and is it peaceful, disruptive (blocking roads), or violent (damage, fires, clashes)?',
    'What is the cause or target — is the company, one of its brands, a partner, or a neighboring business the focus?',
    'Is a curfew, state of emergency, or travel advisory in effect? Issued by whom, for which hours and area?',
  ]),
  intakeGroup('t-civil-unrest-travel', 'Guests, Groups & Movement', [
    'Are any tour groups, bike tours, or ship port calls in or scheduled for the area? Where are they now?',
    'Are roads, airports, rail, or ports affected, and is there a safe route to lodging or out of the area?',
    'Have police used crowd-control measures (tear gas, barricades, closures) near guests or staff?',
  ]),
];

// ── Exports ──────────────────────────────────────────────────────────────────

export const SECURITY_TYPE_CHECKLISTS: Record<string, ChecklistBlockItem[]> = {
  'violence-threat': VIOLENCE_THREAT,
  'suspicious-activity': SUSPICIOUS_ACTIVITY,
  theft: THEFT,
  'civil-unrest': CIVIL_UNREST,
};

export const SECURITY_TYPE_INTAKE: Record<string, IntakeBlockGroup[]> = {
  'violence-threat': VIOLENCE_THREAT_INTAKE,
  'suspicious-activity': SUSPICIOUS_ACTIVITY_INTAKE,
  theft: THEFT_INTAKE,
  'civil-unrest': CIVIL_UNREST_INTAKE,
};
