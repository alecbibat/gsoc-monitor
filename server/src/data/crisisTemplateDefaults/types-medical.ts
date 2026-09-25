// Incident-type scope defaults — Medical & Life Safety: medical,
// mass-casualty, fatality, search-rescue, public-health.
//
// These lists add only what is specific to the incident type; the General
// scope (general.ts + legacy.ts) already covers generic ICS work such as
// confirming the report, 911 and leadership notifications, accountability,
// perimeters, ICS 206 medical support, next-of-kin inquiry messaging, injury
// claims paperwork and the GSOC incident record. Property-specific items live
// in properties.ts.
//
// Privacy runs through every list: patients and the deceased are recorded by
// initials or case number, medical details stay out of share links and public
// statements, and next of kin are notified only by law enforcement or the
// coroner/medical examiner — never by company staff.
//
// Ids are minted from position (helpers.ts): append new lines at the END of a
// list — never reorder or delete published lines.

import type { ChecklistBlockItem, IntakeBlockGroup } from '../../crisisTemplates/types';
import { checklistItems, intakeGroup } from './helpers';

// ── Medical ──────────────────────────────────────────────────────────────────
// A guest, employee or visitor needing emergency care: cardiac arrest, fall,
// allergic reaction, illness on a trail, tour, train or ship.

const MEDICAL = checklistItems('t-medical', {
  ic: {
    immediate: [
      'Decide early whether distance, terrain or EMS delay warrants air medical transport, and have the request made through 911/EMS dispatch.',
      'Name one company contact to stay with the patient or their companions through transport and hospital admission.',
    ],
  },
  'gsoc-support': {
    immediate: [
      "Open the property's location panel and send the on-scene lead the nearest hospital with an emergency department, its drive time and directions.",
      'Log the patient by initials or case number only; keep names and medical details out of the Executive Summary and share links.',
      'If air medical transport is requested, check Wind, Radar, Lightning and NWS Alerts at the scene and landing zone and relay any concerns.',
    ],
    ongoing: [
      'Follow the air ambulance on the Flights (ADS-B) layer when it is broadcasting and update the on-scene lead with its ETA.',
      'Track transport status and the receiving hospital, and tell the IC when the patient has been handed over to hospital care.',
      'If the patient dies or more patients are found, change the incident type to Fatality or Mass Casualty so the right checklist loads.',
    ],
    demob: [
      'Record the final disposition (treated at scene, refused care, transported, admitted) and the receiving hospital in the Action Log.',
    ],
  },
  safety: {
    immediate: [
      'Confirm the scene is safe to approach (traffic, electrical, water, rockfall, wildlife, violence) before staff reach the patient.',
      'Confirm first-aid responders use gloves and CPR barriers and bag blood-contaminated materials as biohazard waste.',
    ],
    ongoing: [
      'If a property condition, equipment, food or an activity may have contributed, photograph and preserve it before cleanup or repair.',
    ],
  },
  pio: {
    immediate: [
      "Release no patient name, condition or medical details; refer inquiries about the patient's condition to the family or the hospital.",
    ],
  },
  liaison: {
    immediate: [
      'Confirm which EMS agency responded and the receiving hospital, and record the EMS or agency incident number.',
    ],
    ongoing: [
      "For guests abroad or at sea, coordinate care and evacuation with the travel-assistance provider, port agent and the ship's medical team.",
    ],
  },
  ops: {
    immediate: [
      'Send the nearest AED and first-aid kit to the patient and confirm trained CPR/first-aid staff are on the way.',
      'Post a staff member at the designated entrance to meet EMS and escort them in; hold an elevator and clear the route.',
      'For trails, rivers or backcountry, give dispatch GPS coordinates and the nearest vehicle access point or helicopter landing zone.',
      'Screen the patient from onlookers, move bystanders away, and keep the patient\'s ID, medications and belongings with them.',
    ],
    ongoing: [
      'Give companions a private space, updates, a named company contact and hospital transport; arrange stay extensions or tour changes.',
    ],
  },
  planning: {
    immediate: [
      'Start a timeline: collapse or injury, first aid started, AED shocks, EMS arrival and departure, and hospital arrival.',
    ],
  },
  logistics: {
    immediate: [
      'Mark an air ambulance landing zone if requested: about 100 x 100 ft, level, clear of wires and debris, with the area kept clear of people.',
    ],
    demob: [
      'Return the AED to service (new pads, battery checked), restock first-aid supplies, and log the AED use.',
    ],
  },
  finance: {
    ongoing: [
      'Track transport, lodging and companion-support costs the company pays and note any goodwill payments for Risk review.',
    ],
  },
});

const MEDICAL_INTAKE = [
  intakeGroup('t-medical', 'Patient & Care', [
    'Is the patient a guest, employee, contractor or member of the public? Approximate age and sex (no name needed here).',
    'What is the emergency (cardiac, breathing, fall or trauma, allergic reaction, illness, other)? Is the patient conscious and breathing?',
    'Is CPR or first aid in progress? Has an AED been brought to the patient or used?',
    'Did a property condition, equipment, food or an activity (tour, ride, excursion) play a part?',
  ]),
  intakeGroup('t-medical-access', 'EMS Access & Companions', [
    'Where exactly is the patient, and how will EMS reach them (entrance, trail, road, dock, helicopter landing zone)?',
    'Has EMS been dispatched, what is its estimated arrival, and is air medical transport requested or likely?',
    'Who is with the patient (companions, family, tour group), and do they need help or a company contact?',
  ]),
];

// ── Mass Casualty ────────────────────────────────────────────────────────────
// More patients than local EMS can handle at once: coach or train crash,
// structural collapse, carbon monoxide, mass illness, violence.

const MASS_CASUALTY = checklistItems('t-mass-casualty', {
  ic: {
    immediate: [
      'Confirm with EMS that a mass casualty incident is declared and who holds medical command, triage and transport.',
      'Name one casualty-tracking lead and require every patient movement and status change to be reported to them.',
      'Decide where uninjured guests and arriving families will be received and set up reunification early.',
    ],
    ongoing: [
      'Deploy company care-team, HR and travel-services staff to each receiving hospital and the family assistance center.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Pull the manifest, rooming list or roster for the affected group or area and share it only with the casualty-tracking lead.',
      "List hospitals within transport range from the location panel (emergency departments, trauma and burn centers) and send it to Planning.",
    ],
    ongoing: [
      'Reconcile the manifest against patient tracking and reunification counts every 30 minutes; report unaccounted persons to the IC.',
      'Watch Flights (ADS-B), OSINT/news and scanner feeds for air ambulance moves, hospital diversions and casualty counts; flag mismatches.',
      'Keep casualty counts in the Executive Summary sourced and time-stamped, and never publish unconfirmed numbers through share links.',
    ],
    demob: [
      'Confirm every name on the manifest has a final status (uninjured, treated and released, admitted, deceased) before stand-down.',
    ],
  },
  safety: {
    immediate: [
      'Keep untrained staff out of the triage and treatment areas and away from secondary hazards (traffic, fuel, unstable structures).',
    ],
    ongoing: [
      'Arrange critical-incident stress defusing and EAP contacts for staff who treated patients or saw the scene, before they go off shift.',
    ],
  },
  pio: {
    immediate: [
      'Confirm casualty numbers only through the lead agency; release no names or conditions until the agency and families allow it.',
    ],
    ongoing: [
      'Publish one family inquiry line once approved, staffed by trained call takers, and align every statement with the lead agency PIO.',
    ],
  },
  liaison: {
    immediate: [
      "Contact each receiving hospital's emergency department or hospital command center to confirm which patients it has received.",
    ],
    ongoing: [
      'Place a company representative at the family assistance or reunification center run by EMS, public health or emergency management.',
    ],
  },
  ops: {
    immediate: [
      'Support EMS START triage with trained staff only and move walking wounded to the designated casualty collection point.',
      'Set separate areas for uninjured guests, arriving families and media, all away from the treatment area and ambulance routes.',
      'Keep ambulance access routes and a helicopter landing zone clear, and post staff to direct arriving units.',
    ],
    ongoing: [
      'At the reunification point, record every uninjured person who leaves, who they leave with and where they are going.',
    ],
  },
  planning: {
    immediate: [
      'Start a patient tracking log: triage tag number, triage category, name when known, transporting unit and destination hospital.',
    ],
    ongoing: [
      'Keep one status list for every person involved and update it each time a hospital or agency confirms a status.',
    ],
  },
  logistics: {
    immediate: [
      'Provide blankets, water, shelter and buses for uninjured guests to the reunification site or alternate lodging.',
    ],
    ongoing: [
      'Arrange lodging, meals and ground transport near receiving hospitals for family members and deployed care-team staff.',
    ],
  },
  finance: {
    ongoing: [
      'Authorize emergency funds for affected families (travel, lodging, meals) and track each disbursement by guest and hospital.',
    ],
  },
});

const MASS_CASUALTY_INTAKE = [
  intakeGroup('t-mass-casualty', 'Casualties & Triage', [
    'About how many people are injured, and how many are immediate (red), delayed (yellow), minor (green) or deceased (black)?',
    'What caused the casualties (vehicle or train crash, structural collapse, fire, carbon monoxide, violence, food or water, other)?',
    'Which EMS agency has medical command, and where are the triage and treatment areas?',
    'Which hospitals are patients going to, and is air medical transport in use?',
  ]),
  intakeGroup('t-mass-casualty-reunification', 'Accountability & Reunification', [
    'Is there a manifest, rooming list or roster for everyone involved, and who holds it?',
    'How many uninjured people are at the scene, and where are they being gathered?',
    'Are families arriving or calling, and has a reunification or family assistance location been set up?',
  ]),
];

// ── Fatality ─────────────────────────────────────────────────────────────────
// A death of a guest, employee or visitor on a property, tour, train or ship.

const FATALITY = checklistItems('t-fatality', {
  ic: {
    immediate: [
      'Confirm which agency has jurisdiction over the death (police, sheriff, NPS rangers, coroner or medical examiner) and that it is notified.',
      'Direct that no company staff contact the next of kin until law enforcement or the coroner confirms notification is complete.',
    ],
    ongoing: [
      'Assign a trained care-team member as the single company contact for the family once notification is confirmed.',
      "Decide on support for the deceased's companions and tour group: lodging, transport, counseling and itinerary changes.",
    ],
  },
  'gsoc-support': {
    immediate: [
      'Log the deceased by initials or case number only and keep identity and cause out of the Executive Summary and share links.',
      'Confirm the fatality notifications (Legal, Risk, HR for employees, executive leadership) are made and logged with times.',
    ],
    ongoing: [
      "Monitor news, social media and scanner feeds for the deceased's name or images before official notification; alert the PIO and Liaison.",
      'Log the time law enforcement or the coroner confirms next-of-kin notification; no family or public communication goes out before it.',
    ],
    demob: [
      'Move photos, statements and other sensitive records to Legal and confirm none remain in chat channels or shared folders.',
    ],
  },
  safety: {
    immediate: [
      'Preserve the scene: do not move the deceased or nearby objects, screen from view only if needed, and log everyone who enters.',
      'For a work-related employee death, confirm Risk/Legal reports it to OSHA (or the state plan) within 8 hours.',
    ],
    ongoing: [
      'Offer the Employee Assistance Program and on-site grief support to staff involved, and record who has been offered it.',
    ],
  },
  pio: {
    immediate: [
      'Release no name, cause of death or details; any statement expresses condolences and defers to the investigating agency.',
    ],
    ongoing: [
      "Release or confirm the deceased's name only after the investigating agency does, and coordinate every statement with its PIO.",
    ],
  },
  liaison: {
    immediate: [
      'Establish contact with the investigating officer and the coroner or medical examiner; record the case number and release process.',
    ],
    ongoing: [
      'For a foreign national or a death abroad or at sea, coordinate with the consulate or embassy and travel-assistance provider on repatriation.',
    ],
  },
  ops: {
    immediate: [
      'Secure the room, vehicle or area with a staff member posted at the access point until investigators release it.',
      'Move guests in adjacent rooms or the tour group away from the scene and give companions a private space with a staff member.',
    ],
    ongoing: [
      'Plan the removal of the deceased with the coroner: service entrance, timing and a route clear of guests.',
      "Inventory the deceased's belongings with a witness and hold them until released to the agency or the family's designee.",
    ],
    demob: [
      'Keep the room or area out of service until investigators release it, then arrange professional biohazard cleaning if needed.',
    ],
  },
  planning: {
    ongoing: [
      'Collect witness names, staff statements and a timeline, and preserve CCTV, key-card and radio logs under legal hold.',
    ],
  },
  logistics: {
    ongoing: [
      'Arrange lodging, meals and ground transport for traveling companions and arriving family members.',
    ],
  },
  finance: {
    ongoing: [
      'Notify insurers as Risk directs and track family support, repatriation and cleanup costs under the incident cost code.',
    ],
  },
});

const FATALITY_INTAKE = [
  intakeGroup('t-fatality', 'Deceased & Jurisdiction', [
    'Is the deceased a guest, employee, contractor or member of the public? Use initials or a case number here, not the full name.',
    'Where and when did the death occur or was the person found, and who found them?',
    'What is the apparent circumstance (medical, fall, drowning, vehicle, violence, unknown)? Report only what was observed.',
    'Which agency has jurisdiction (police, sheriff, NPS rangers, coroner or medical examiner), and is it on scene?',
    'Has the scene been secured, and has anything been moved or touched?',
  ]),
  intakeGroup('t-fatality-family', 'Companions & Notification', [
    'Was the deceased traveling with anyone? Where are those companions now, and who is with them?',
    'Has law enforcement or the coroner confirmed next-of-kin notification? (Company staff must not notify the family.)',
    'Did other guests or employees witness the death, and do any of them need support?',
  ]),
];

// ── Search & Rescue ──────────────────────────────────────────────────────────
// A missing or overdue guest, employee or tour member — on a trail, river,
// bike route, at sea, or a missing child on property.

const SEARCH_RESCUE = checklistItems('t-search-rescue', {
  ic: {
    immediate: [
      'Confirm the agency with SAR authority (county sheriff, NPS, or the Coast Guard at sea) has been notified and is leading the search.',
      'Authorize a hasty search of buildings, grounds and vehicles by staff within property limits only; field searching is for the SAR lead.',
    ],
    ongoing: [
      'Agree check-in times with the SAR lead and how the company will hear of status changes, suspension or recovery.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Pin the point last seen and the planned destination on the map and share that view (not personal data) with the SAR liaison.',
      "Pull the subject's reservation, itinerary, tour or permit record, vehicle or rental details and phone number for the SAR lead.",
      'Check NWS Alerts, Radar, Lightning, Wind and overnight low temperatures for the search area and brief the IC on survival risk.',
    ],
    ongoing: [
      'Watch the search area for storms, flash-flood warnings and river gauge rises, and alert the IC and Safety to each change.',
      'Monitor OSINT, news and social media for sightings, posts by the subject or self-organized volunteer searches; pass leads to Liaison.',
      'For a person overboard or overdue boat, use Ships (AIS) to list vessels near the last known position and pass them to the Coast Guard.',
    ],
    demob: [
      'Log the outcome, time and location found in the Action Log, then clear or archive the search pins and drawings.',
    ],
  },
  safety: {
    immediate: [
      'Stop staff from self-deploying into terrain, water or weather beyond their training; volunteers join only through the SAR lead.',
    ],
    ongoing: [
      'For staff assigned to the search, confirm check-in and check-out, buddy pairs, radios and turnaround times.',
    ],
  },
  pio: {
    immediate: [
      "Refer public information on the search to the lead agency; release the subject's name or photo only if the agency asks for it.",
    ],
    ongoing: [
      "Discourage guests and the public from searching on their own; direct offers of help to the lead agency's volunteer process.",
    ],
  },
  liaison: {
    immediate: [
      'Give the SAR lead one company contact and the subject profile, and record the agency incident number and briefing schedule.',
    ],
    ongoing: [
      "Coordinate contact with the subject's family through the agency's family liaison and agree who from the company speaks with them.",
    ],
  },
  ops: {
    immediate: [
      'Establish the point last seen: who saw the subject, when and where, what they wore and carried, and their stated plan.',
      "Check the subject's room, vehicle, bike or rental and the trailhead; leave worn clothing untouched for search dogs.",
      'Account for the rest of the group or tour, and hold guides and witnesses until the SAR lead has interviewed them.',
    ],
    ongoing: [
      'Keep a staff member at the room, trailhead or last known point if the SAR lead asks, in case the subject returns.',
    ],
  },
  planning: {
    immediate: [
      'Build the subject profile: age, fitness, medical conditions and medications, experience, clothing colors, gear, phone and battery.',
    ],
  },
  logistics: {
    ongoing: [
      'Support the SAR staging area on request: lodging, meals, parking, power and a warm room for searchers and the family.',
    ],
  },
  finance: {
    ongoing: [
      'Track company support costs for the search (lodging, meals, transport) and log any agency cost-recovery requests.',
    ],
  },
});

const SEARCH_RESCUE_INTAKE = [
  intakeGroup('t-search-rescue', 'Missing Person Profile', [
    'Who is missing (guest, employee, tour member), how old are they, and do they have medical conditions or need medication?',
    'Where and when were they last seen, and by whom (point last seen)?',
    'What were they wearing and carrying (clothing colors, pack, water, light, phone), and do they have a vehicle, bike or rental?',
    'What was their plan (trail, route, destination, permit or tour itinerary), and when were they due back?',
  ]),
  intakeGroup('t-search-rescue-response', 'Search Response', [
    'Which agency is leading the search (county sheriff, NPS, Coast Guard), and has it issued an incident number?',
    "Has anyone called or texted the subject's phone, and when did it last connect?",
    'What are the terrain, water and weather conditions in the search area, including the overnight low?',
  ]),
];

// ── Public Health ────────────────────────────────────────────────────────────
// Illness clusters and communicable-disease exposures: norovirus and other
// GI illness, foodborne outbreaks, Legionella, measles and similar.

const PUBLIC_HEALTH = checklistItems('t-public-health', {
  ic: {
    immediate: [
      'Name one outbreak lead (e.g., the GM or food and beverage director) to own the case log, cleaning program and health department contact.',
      'Agree control measures with the health department: buffet changes, outlet or activity closures, and ill-guest isolation.',
    ],
    ongoing: [
      'Review new cases each operational period with the health department and decide whether to tighten controls, close outlets or stop arrivals.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Check OSINT/news and health-department advisories for the same illness in the area or at other properties, and alert the IC to any match.',
      'Alert the GMs of properties, ships and tours that share guests, staff, suppliers or itineraries with the affected site.',
    ],
    ongoing: [
      'Update daily case counts (new and total, guests vs. staff) and the date of the last new case in the Executive Summary.',
      'Monitor OSINT, review sites and social media for illness complaints naming the property or ship and route them to the PIO.',
      'Watch FDA, USDA and CDC recall and outbreak notices for products or suppliers the property uses and alert Logistics.',
    ],
    demob: [
      'Log the date the health department declares the outbreak over, then stop the daily case-count updates.',
    ],
  },
  safety: {
    immediate: [
      'Issue gloves, gowns and masks to staff cleaning vomit, diarrhea or ill-guest rooms, and confirm they know the spill-kit procedure.',
      'Exclude ill employees, food handlers first, until symptom-free for at least 48 hours or longer if the health department directs.',
    ],
    ongoing: [
      'Verify enhanced cleaning uses an EPA List G (norovirus) disinfectant or bleach at the label concentration and contact time.',
      'Check employee housing, break rooms and staff dining for spread, and separate ill staff from well roommates where possible.',
    ],
  },
  pio: {
    immediate: [
      'Post health-department-approved guest notices on handwashing, reporting symptoms and requesting in-room care.',
    ],
    ongoing: [
      'Coordinate public statements with the health department and name no cause or food source until it confirms one.',
    ],
  },
  liaison: {
    immediate: [
      'Report the illness cluster to the local health department and record the assigned investigator, case definition and reporting schedule.',
      "For a ship, confirm the ship's medical team files the GI illness reports the CDC Vessel Sanitation Program requires for U.S. port calls.",
    ],
    ongoing: [
      'Release guest or staff contact lists to the health department only on its request and after Legal/privacy review.',
    ],
  },
  ops: {
    immediate: [
      'Ask ill guests to stay in their rooms, and provide room-service meals, fluids and a way to request a medical consult.',
      'Switch buffets and self-service stations to staff-served and remove shared items (condiments, fruit bowls, pens) from public areas.',
    ],
    ongoing: [
      'Put ill-guest rooms on a separate cleaning protocol: dedicated staff, sealed linen bags, and full disinfection at checkout.',
    ],
  },
  planning: {
    immediate: [
      'Start a case log: onset date and time, symptoms, room, meals and activities in the prior 72 hours, and guest or staff status.',
    ],
  },
  logistics: {
    immediate: [
      'Hold samples of suspect food, menus, supplier invoices and lot numbers; set implicated product aside on hold rather than discarding it.',
    ],
    ongoing: [
      'Stock disinfectant, PPE, spill kits, hand-sanitizer stations and oral rehydration supplies for the expected duration.',
    ],
  },
  finance: {
    ongoing: [
      'Track outbreak costs: deep cleaning, discarded food, closed outlets, guest compensation and medical consultations.',
    ],
  },
});

const PUBLIC_HEALTH_INTAKE = [
  intakeGroup('t-public-health', 'Illness & Cases', [
    'What symptoms are reported (vomiting, diarrhea, fever, rash, respiratory), and when did the first case start?',
    'How many people are ill — guests versus staff — and how many new cases in the last 24 hours?',
    'Is there a suspected common source (a meal, outlet, water, pool or spa, excursion, or an ill employee)?',
    'Has anyone been hospitalized or seen by a medical provider, and has a diagnosis been confirmed?',
  ]),
  intakeGroup('t-public-health-controls', 'Notifications & Controls', [
    'Has the local health department (or CDC Vessel Sanitation Program, for a ship) been notified, and what has it directed?',
    'What control measures are in place (isolation of ill people, enhanced cleaning, buffet changes, closures)?',
    'Are suspect food samples, menus and supplier records being held?',
  ]),
];

// ── Exports ──────────────────────────────────────────────────────────────────

export const MEDICAL_TYPE_CHECKLISTS: Record<string, ChecklistBlockItem[]> = {
  medical: MEDICAL,
  'mass-casualty': MASS_CASUALTY,
  fatality: FATALITY,
  'search-rescue': SEARCH_RESCUE,
  'public-health': PUBLIC_HEALTH,
};

export const MEDICAL_TYPE_INTAKE: Record<string, IntakeBlockGroup[]> = {
  medical: MEDICAL_INTAKE,
  'mass-casualty': MASS_CASUALTY_INTAKE,
  fatality: FATALITY_INTAKE,
  'search-rescue': SEARCH_RESCUE_INTAKE,
  'public-health': PUBLIC_HEALTH_INTAKE,
};
