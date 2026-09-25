// Incident-type scope defaults — Operational (road closure / access,
// maritime, aviation) and Other.
//
// Only what is specific to the incident type lives here; generic ICS duties
// are in the General scope and property specifics in properties.ts. Layer
// names match the map sidebar (NWS Alerts, Precipitation Radar, Rivers &
// Floods (NWPS), Wind (GFS), Lightning, Hurricanes, Power Outages, Flights
// (ADS-B), Ships (AIS), Intel Feed, News, Property Watch).
//
// Maritime: the original vessel-grounding checklist and intake
// (LEGACY_MARITIME_* in legacy.ts) lead the Maritime type automatically, so
// the lists below only ADD what grounding does not cover — fire aboard, man
// overboard, medical evacuation at sea, collision, security threats, flag /
// port state and P&I notifications, disembarkation and next-port logistics.
//
// Ids are minted from list positions (see helpers.ts): once published, append
// new lines at the END of a list — never reorder or delete lines.

import type { ChecklistBlockItem, IntakeBlockGroup } from '../../crisisTemplates/types';
import { checklistItems, intakeGroup } from './helpers';

// ── Road Closure / Access ────────────────────────────────────────────────────

const ROAD_ACCESS = checklistItems('t-road-access', {
  ic: {
    immediate: [
      'Decide whether to hold, reroute or cancel arrivals, departures, tours and deliveries until the road agency gives a reopening estimate.',
      'Decide whether the property can operate cut off for 24+ hours or needs a supported guest departure while a route is still open.',
    ],
    ongoing: [
      "Tie decisions (releasing rooms, moving groups, extending closure notices) to the agency's reopening estimate and revisit them at each update.",
    ],
  },
  'gsoc-support': {
    immediate: [
      'Confirm the closure on the state DOT or NPS road-status source; log the closed segment, cause, closing agency and reopening estimate.',
      'Draw the closure and detour on the incident map and check NWS Alerts, Precipitation Radar and Rivers & Floods for conditions that could extend it.',
      'List guests, tour coaches, shuttles and employees on the closed route now or due to use it in the next 24 hours and send it to Operations.',
    ],
    ongoing: [
      'Recheck DOT/NPS road status, the Intel Feed and News at least hourly; log every change to closure limits, detours or convoy windows.',
      'Watch NWS Alerts, Power Outages and Rivers & Floods along detour routes and warn Operations before coaches or guests are sent that way.',
    ],
    demob: [
      'Confirm the reopening with the closing agency (not news reports alone), log the time, and tell the GM, reservations and transport vendors.',
    ],
  },
  safety: {
    immediate: [
      'Tell staff and guests not to bypass barricades, cross slide debris or washouts, or drive through water over the road.',
    ],
    ongoing: [
      'Check detour routes for coach and staff-vehicle suitability: grade, width, winter conditions, cell coverage and fuel stops.',
      'If the property is cut off, confirm on-site first-aid capability and an air-medical landing zone plan with local EMS.',
    ],
  },
  pio: {
    immediate: [
      'Send arriving guests the closure, the recommended detour and added travel time, and warn them not to follow GPS routing around closures.',
    ],
    ongoing: [
      'Post road-status updates for in-house guests at the front desk and in rooms, including any convoy or pilot-car departure times.',
    ],
  },
  liaison: {
    immediate: [
      'Reach the state DOT district, county road department or NPS roads/dispatch for closure extent, cause, reopening estimate and convoy windows.',
    ],
    ongoing: [
      'Request priority access or escorted windows for supply trucks, critical staff and emergency vehicles, and log each approval.',
      'Alert county emergency management if the closure isolates the property or employee housing from EMS or fire response.',
    ],
  },
  ops: {
    immediate: [
      'Reroute or hold shuttles, tour coaches, excursions and rail/bus connections, and confirm every driver has the approved detour.',
      'Redirect or reschedule inbound food, fuel, propane and linen deliveries and have vendors hold trucks at a staging point.',
    ],
    ongoing: [
      'Cover shifts for employees who cannot commute: hold over on-site staff, lodge key staff on property, or arrange carpools on open routes.',
      'Run guest departures in the convoy or pilot-car windows set by the road agency and record who left and when.',
    ],
    demob: [
      'Restart shuttles, tours and deliveries only after the first run over the reopened road confirms conditions are safe.',
    ],
  },
  planning: {
    ongoing: [
      'Plan for short, multi-day and season-long closures; track stranded guests, arrivals unable to reach the property and extended stays.',
    ],
  },
  logistics: {
    immediate: [
      'Inventory food, potable water, fuel, propane and medical supplies and estimate how many days the property can operate cut off.',
    ],
    ongoing: [
      'Arrange lodging or transport for guests stranded outside the closure and for employees who cannot get home.',
    ],
  },
  finance: {
    ongoing: [
      'Track extra nights for stranded guests, detour transport, delivery surcharges and staff lodging under the incident cost code.',
    ],
  },
});

const ROAD_ACCESS_INTAKE = [
  intakeGroup('t-road-access', 'Closure & Route', [
    'Which road or segment is closed, between which points, and why (avalanche, rockslide, washout, crash, fire, flooding, construction)?',
    'Which agency closed it (NPS, state DOT, county, police), and is there a reopening estimate?',
    'Is the property cut off, or is a detour open? How much time does it add, and is it suitable for coaches?',
    'Are any guests, staff, coaches or company vehicles stuck on or between the closure points right now?',
  ]),
  intakeGroup('t-road-access-impact', 'Arrivals, Supplies & Staff', [
    'How many guests, groups and tour coaches are due to arrive or depart on this route in the next 24–48 hours?',
    'How many days of food, water, fuel and medical supplies are on hand if deliveries cannot get through?',
    'How many employees cannot get to work or get home, and which critical positions are affected?',
    'Can emergency vehicles still reach the property, and is air-medical access available if needed?',
  ]),
];

// ── Maritime (complements the legacy vessel-grounding content) ─────────────

const MARITIME = checklistItems('t-maritime', {
  ic: {
    immediate: [
      "For fire aboard, confirm with the Master and DPA whether the fire is contained and whether the ship needs to divert, abandon or request assistance.",
    ],
  },
  'gsoc-support': {
    immediate: [
      "Find the ship in Ships (AIS); log its position, speed, heading and last-fix time, and flag any gap in AIS reports to the DPA.",
      'For man overboard, log the ship\'s AIS position at the reported time and confirm the Master has alerted the Coast Guard/rescue center.',
    ],
    ongoing: [
      "Watch NWS Alerts, Hurricanes and Wind along the ship's track and toward the diversion port, and brief the DPA on changes.",
    ],
  },
  safety: {
    immediate: [
      'For a security threat or piracy, confirm the Ship Security Officer has set the security level and the Company Security Officer is informed.',
    ],
  },
  pio: {
    ongoing: [
      'Coordinate itinerary-change and cancellation messages for guests, families and travel advisors once the DPA confirms the plan.',
    ],
  },
  liaison: {
    immediate: [
      "Through the DPA, confirm flag state and port state authorities at the current or next port are notified per their reporting rules.",
    ],
    ongoing: [
      "After a collision, get the other vessel's name, flag and owner from the Master and AIS, and log all contact with its owner or agent.",
    ],
  },
  ops: {
    immediate: [
      'For a medical evacuation at sea, confirm the transfer method (helicopter, boat or next port), receiving hospital and who escorts the guest.',
    ],
    ongoing: [
      'Plan guest disembarkation at the nearest suitable port: tender or pier, immigration clearance, hotels, flights and luggage.',
    ],
  },
  logistics: {
    ongoing: [
      'Brief the port agents at the current and next ports on itinerary changes, provisioning, crew changes, repairs and guest transfers.',
    ],
  },
  finance: {
    immediate: [
      "Notify the P&I club and hull & machinery insurers and ask for their local correspondent or surveyor to attend.",
    ],
  },
});

const MARITIME_INTAKE = [
  intakeGroup('t-maritime-emergency', 'Other Vessel Emergencies', [
    'What kind of emergency is it: fire, man overboard, medical evacuation, collision, security threat, or machinery/power failure?',
    'If fire aboard: where is it, is it contained or spreading, and have the fire teams and boundary cooling been deployed?',
    'If man overboard: when and where did the person go over, are they a guest or crew member, and is a search under way?',
    "If medical evacuation: what is the patient's condition, and will they transfer by helicopter, boat or at the next port?",
    'If collision or security threat: which vessel or party is involved, and what damage or threat remains?',
    'Will the itinerary change? What is the nearest suitable port and the estimated arrival time?',
  ]),
];

// ── Aviation ─────────────────────────────────────────────────────────────────

const AVIATION = checklistItems('t-aviation', {
  ic: {
    immediate: [
      'Establish whether the aircraft is company-operated (flight department) or a charter or air-tour operator, and set who leads the response.',
      'Confirm the operator has notified the NTSB and FAA of an accident or serious incident; log who called, when and any reference number.',
    ],
    ongoing: [
      "Activate the flight department's emergency response plan and family assistance if company crew, employees or guests are hurt or killed.",
    ],
  },
  'gsoc-support': {
    immediate: [
      "Pull the aircraft's last position, altitude and track from Flights (ADS-B) and log the last-fix time and location.",
      'Get the passenger and crew manifest from the operator or flight department and match names against guest, employee and tour records.',
      'Record the weather at the time of the event: NWS Alerts, Wind, Lightning and Precipitation Radar at departure, en route and at the site.',
    ],
    ongoing: [
      'Monitor News and the Intel Feed for crash images, victim names or speculation and alert the PIO before next-of-kin notification is done.',
      'Keep the manifest status current (uninjured, hospital, unaccounted for) and share it only with need-to-know responders.',
    ],
    demob: [
      'Save the ADS-B track, event-time weather and GSOC notification log to the incident record for the investigation and after-action review.',
    ],
  },
  safety: {
    immediate: [
      'Keep people upwind and clear of the aircraft or hangar until fire/ARFF confirms fuel, oxygen, battery and pressurized-system hazards are safe.',
      'For a hangar fire or fuel spill, stop fueling, remove ignition sources, evacuate the hangar and confirm airport ARFF has been called.',
    ],
    ongoing: [
      "Coordinate post-accident drug and alcohol testing of involved crew and maintenance staff per the operator's program and FAA rules.",
    ],
  },
  pio: {
    immediate: [
      'Release no names, tail numbers or cause speculation; refer investigation questions to the NTSB and hold names until next of kin are told.',
    ],
    ongoing: [
      "For a charter or air-tour incident, align statements with the operator; the company does not speak for the operator's flight operations.",
    ],
  },
  liaison: {
    immediate: [
      'Contact airport operations and ARFF for events on the field, or the county sheriff and land agency (e.g., NPS) for an off-airport site.',
    ],
    ongoing: [
      'Act as the single company contact for NTSB and FAA investigators; log every request for records, people or site access.',
    ],
  },
  ops: {
    immediate: [
      'Secure the aircraft, wreckage and debris; allow nothing to be moved except for rescue or firefighting until investigators release it.',
      'Reconcile the manifest against people on scene and at hospitals and report anyone unaccounted for to the IC immediately.',
    ],
    ongoing: [
      'Arrange lodging, onward travel and a staff escort for uninjured passengers and for guests whose companions were aboard.',
    ],
  },
  planning: {
    immediate: [
      'Preserve flight records: aircraft and maintenance logbooks, flight plan, weight and balance, fuel tickets and crew duty and training records.',
    ],
  },
  logistics: {
    ongoing: [
      'Arrange a fuel-spill contractor and alternate hangar space; move undamaged aircraft only with fire and investigator clearance.',
    ],
  },
  finance: {
    immediate: [
      "Notify the aviation insurer or broker and preserve charter contracts, air-tour bookings, invoices and waivers for the flight.",
    ],
  },
});

const AVIATION_INTAKE = [
  intakeGroup('t-aviation', 'Aircraft & Event', [
    'What aircraft is involved (type, tail number), and who operates it — the company flight department, a charter or an air-tour operator?',
    'What happened (crash, forced landing, runway excursion, hangar fire, fuel spill, ground damage, in-flight medical) and exactly where?',
    'How many passengers and crew were aboard, and are any company guests or employees among them?',
    'Is there fire, fuel leaking or smoke, and are ARFF/fire and EMS on scene?',
  ]),
  intakeGroup('t-aviation-records', 'Notifications & Records', [
    'Has the operator notified the NTSB and FAA? Who called, when, and is there a reference number?',
    'Who holds the passenger and crew manifest, and has it been checked against the booking or tour roster?',
    'Are the wreckage or damaged aircraft secured, and are logbooks, the flight plan and fuel records being preserved?',
  ]),
];

// ── Other ────────────────────────────────────────────────────────────────────

const OTHER = checklistItems('t-other', {
  ic: {
    immediate: [
      'Review the classification: if a defined incident type fits, have GSOC change it so the matching checklist and intake questions load.',
      'Set the escalation level (monitor only, property response, or corporate crisis team) and name who owns the incident.',
    ],
    ongoing: [
      'Revisit the incident type and escalation level each operational period as the facts become clearer.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Log in the Action Log why no standard incident type fits and which types were considered.',
      'Enable the map layers and feeds that apply to this event, and note any information need the tool cannot cover.',
    ],
    ongoing: [
      'Change the incident type as soon as the IC confirms a better fit, and tell responders the checklist and intake questions have changed.',
    ],
    demob: [
      'Note in the after-action report whether this kind of event needs its own incident type, checklist or intake questions.',
    ],
  },
  pio: {
    immediate: [
      'Hold external statements until the incident is classified unless guests, staff or media need safety information now.',
    ],
  },
  liaison: {
    immediate: [
      'Identify which agency, regulator or business partner has jurisdiction or must be notified for this type of event.',
    ],
  },
  planning: {
    immediate: [
      'List known facts, unknowns and assumptions, and identify the departments or subject-matter experts who need to assess the event.',
    ],
  },
});

const OTHER_INTAKE = [
  intakeGroup('t-other', 'Classification & Escalation', [
    'Which incident type comes closest, and what makes this incident different?',
    'What could it affect: guests, employees, operations, reputation, or legal/regulatory standing?',
    'Could the situation escalate, and what would trigger escalation?',
    'Which departments, agencies or outside experts are involved or should be?',
  ]),
];

// ── Exports ──────────────────────────────────────────────────────────────────

export const OPS_OTHER_TYPE_CHECKLISTS: Record<string, ChecklistBlockItem[]> = {
  'road-access': ROAD_ACCESS,
  maritime: MARITIME,
  aviation: AVIATION,
  other: OTHER,
};

export const OPS_OTHER_TYPE_INTAKE: Record<string, IntakeBlockGroup[]> = {
  'road-access': ROAD_ACCESS_INTAKE,
  maritime: MARITIME_INTAKE,
  aviation: AVIATION_INTAKE,
  other: OTHER_INTAKE,
};
