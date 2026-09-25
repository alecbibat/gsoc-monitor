// Incident-type scope defaults — Fire & HazMat and Infrastructure:
// structure-fire, hazmat, utility-outage, water-system, it-comms, cyber.
//
// These lists add only what is specific to the incident type; the General
// scope (general.ts + legacy.ts) already covers generic ICS work such as
// confirming the report, notifications, accountability, perimeters, guest
// relocation, cost codes and the GSOC incident record. Property-specific
// items live in properties.ts.
//
// Ids are minted from position (helpers.ts): append new lines at the END of a
// list — never reorder or delete published lines.

import type { ChecklistBlockItem, IntakeBlockGroup } from '../../crisisTemplates/types';
import { checklistItems, intakeGroup } from './helpers';

export const FIRE_INFRA_TYPE_CHECKLISTS: Record<string, ChecklistBlockItem[]> = {
  // ── Fire (Structure) ──────────────────────────────────────────────────────
  'structure-fire': checklistItems('t-structure-fire', {
    ic: {
      immediate: [
        'Confirm the fire department was called even if the fire appears out; company staff support the fire officer in charge and do not direct firefighting.',
        'Confirm the evacuation scope with the fire officer (fire building, adjacent buildings, or defend-in-place floors) and that it has been announced.',
      ],
    },
    'gsoc-support': {
      immediate: [
        'Confirm the alarm with the monitoring company (time received, zone, device, any sprinkler waterflow signal) and log it.',
        'Check Wildfires (NASA FIRMS) and Named Fires (NIFC) to rule out a wildland origin, and Wind to tell the GM which buildings and assembly points are downwind.',
        'Send Ops the room-by-room occupancy list for the affected building, by floor, to reconcile against the sweep and assembly-point headcounts.',
      ],
      ongoing: [
        'Watch NWS alerts for Red Flag Warnings and wind shifts that could carry fire to adjacent buildings or vegetation; alert the IC and nearby GMs.',
      ],
      demob: [
        'Confirm with the monitoring company that the fire alarm account is back in normal service (not on test or bypass) and log the time.',
      ],
    },
    safety: {
      immediate: [
        'Enforce no re-entry for belongings; staff use extinguishers only on incipient fires with a clear exit behind them, then evacuate.',
        'Keep assembly points upwind and clear of fire apparatus lanes, hydrants, and the fire department connection (FDC).',
      ],
      ongoing: [
        'Post a documented fire watch (trained staff patrolling on a set interval) whenever the fire alarm or sprinkler system is impaired.',
        'Before re-entry, check smoke- and water-damaged areas for ceiling, electrical, and slip hazards; require respirators and gloves for soot cleanup.',
      ],
      demob: [
        'Verify sprinkler valves are open, the alarm panel is reset and clear, and fire doors and extinguishers are restored before re-occupancy.',
      ],
    },
    pio: {
      immediate: [
        "Never state or suggest a cause; refer origin-and-cause questions to the fire marshal and clear injury or damage details with the fire department PIO.",
      ],
    },
    liaison: {
      immediate: [
        "Place a company representative with building knowledge and a radio at the fire department's command post.",
      ],
      ongoing: [
        'Coordinate with the fire marshal on the origin-and-cause investigation, scene hold, and when the company may begin cleanup.',
      ],
    },
    ops: {
      immediate: [
        'Sweep the fire floor and floors above only where safe: knock, announce, check bathrooms, close and mark cleared doors; report unchecked rooms.',
        'Meet arriving fire units with master keys, floor plans, alarm panel and riser locations, and rooms of anyone unaccounted for or needing help to evacuate.',
      ],
      ongoing: [
        'Move evacuees from the assembly point to a warm, sheltered reception area and register each guest, room number, and onward plan.',
        'Arrange escorted re-entry for guests to retrieve medication, ID, and keys only when the fire department permits it.',
      ],
    },
    planning: {
      ongoing: [
        'List rooms and outlets out of service with projected return dates so reservations can relocate guests and adjust arrivals.',
      ],
    },
    logistics: {
      immediate: [
        'Get blankets, water, rain/cold protection, and restroom access to assembly points; bring buses or open a nearby building if weather is poor.',
      ],
      ongoing: [
        'Replace essentials for guests who lost belongings (toiletries, clothing, chargers, prescription refills) and log what was provided.',
        'Engage fire/water restoration and board-up contractors, and the fire-protection vendor to inspect and repair the alarm and sprinkler systems.',
      ],
    },
    finance: {
      immediate: [
        'Notify the property insurer/broker of the fire loss, log the claim and fire department report numbers, and keep damaged items for the adjuster.',
      ],
    },
  }),

  // ── HazMat ────────────────────────────────────────────────────────────────
  hazmat: checklistItems('t-hazmat', {
    ic: {
      immediate: [
        'Order protective actions with the fire/hazmat officer (evacuate beyond the isolation distance or shelter in place) without waiting for positive ID.',
      ],
      ongoing: [
        'Keep affected areas closed until air monitoring by the fire department or an industrial hygienist confirms safe levels.',
      ],
    },
    'gsoc-support': {
      immediate: [
        'Look up the material in the current Emergency Response Guidebook (ERG) and give the IC its initial isolation and protective-action distances.',
        'Check the Wind layer for direction and speed at the source and tell the IC which buildings, properties, and assembly points are downwind.',
        'Draw the isolation zone and downwind protective-action area on the map and list the company buildings and people inside them.',
        'For an off-site release (rail, highway, industrial site), monitor alerts and OSINT/news for agency evacuation or shelter-in-place orders and zones.',
      ],
      ongoing: [
        'Re-check the Wind layer and NWS forecast for shifts that move the plume toward other buildings or properties; warn the affected GMs.',
      ],
      demob: [
        'Log the all-clear from the fire/hazmat authority with time, source, and any areas that remain restricted.',
      ],
    },
    safety: {
      immediate: [
        'Keep staff out of the release area: no entering, sniffing to identify, or cleaning up; only trained hazmat responders act.',
        'Get the Safety Data Sheet (SDS) for any on-site product involved (pool chemicals, cleaners, fuel, propane, refrigerant) to the fire department.',
      ],
      ongoing: [
        'Ensure exposed persons are decontaminated as fire/EMS direct before they enter vehicles, lobbies, or the medical area.',
        'Record everyone potentially exposed (name, location, duration, symptoms) for medical follow-up and OSHA recordkeeping.',
      ],
      demob: [
        'Confirm contaminated materials, absorbents, and PPE were removed by a licensed contractor and keep the waste manifests.',
      ],
    },
    pio: {
      immediate: [
        'Give guests plain-language shelter-in-place or evacuation instructions (PA, phone, in-room, text): where to go, what to close, and why.',
      ],
      ongoing: [
        'Align any statement on health effects with the health department or fire authority; do not characterize exposure risk yourself.',
      ],
    },
    liaison: {
      ongoing: [
        'Coordinate protective actions, air/water sampling, and release reporting with fire/hazmat, emergency management, and the environmental agency.',
        "If the release came from a neighboring facility or carrier, obtain the responsible party's contact, the product, and their cleanup plan.",
      ],
    },
    ops: {
      immediate: [
        'To shelter in place: move guests to interior rooms, shut down HVAC and exhaust fans, and close windows, doors, and fresh-air dampers.',
        'To evacuate: route guests upwind and uphill on a path that avoids the plume, to an assembly point outside the isolation distance.',
        'Shut off pool chemical feed pumps or the gas supply only if trained and it can be done outside the hazard area; otherwise leave it to responders.',
      ],
    },
    planning: {
      ongoing: [
        'Plan for an extended shelter-in-place: food, water, restrooms, medications, and guest updates for the expected duration.',
      ],
    },
    logistics: {
      ongoing: [
        'Engage a licensed hazmat/environmental cleanup contractor for removal, disposal, and waste manifests.',
        'Provide replacement clothing, towels, and a warm private area for guests and staff who went through decontamination.',
      ],
    },
    finance: {
      ongoing: [
        'Keep cost records that support recovery from the responsible party or carrier if the release originated off-site.',
      ],
    },
  }),

  // ── Utility / Power Outage ────────────────────────────────────────────────
  'utility-outage': checklistItems('t-utility-outage', {
    ic: {
      immediate: [
        "Confirm the outage scope (building, property, or grid) and the utility's restoration estimate, and set decision points (e.g., 4, 8, 24 hours).",
      ],
      ongoing: [
        'At each decision point, decide on closing outlets, stopping arrivals, or relocating guests if the outage will outlast fuel or safe temperatures.',
      ],
    },
    'gsoc-support': {
      immediate: [
        "Check the Power Outages layer and the utility's outage reports for the area (customers out, cause, restoration estimate) and log them.",
        'Check NWS alerts, radar, lightning, and wind for a weather cause and for more storms or extreme heat/cold forecast during the outage.',
        'Check whether other company properties, corporate offices, or the GSOC itself sit in the outage footprint.',
      ],
      ongoing: [
        'Log each change to the restoration estimate and alert the IC when it slips past a decision point.',
        'Watch for public safety power shutoff (PSPS) notices near any property during fire-weather or high-wind events.',
      ],
      demob: [
        'Confirm power is stable and that remote alarms (fire panel, intrusion, freezer temperature) report normally again.',
      ],
    },
    safety: {
      immediate: [
        'Check every elevator for trapped occupants; call the fire department or elevator contractor for any entrapment and do not let staff attempt rescue.',
        'Confirm the fire alarm and emergency lighting are on battery or generator, note battery time left, and post a fire watch before it runs out.',
        'Prohibit indoor use of portable generators, grills, and fuel heaters; keep generators outdoors, away from doors, windows, and air intakes (CO).',
      ],
    },
    pio: {
      immediate: [
        'Tell guests what still works (lights, water, dining, elevators, Wi-Fi), where to charge devices, and when the next update is due.',
      ],
    },
    liaison: {
      immediate: [
        "Reach the utility's emergency or key-account contact and report the property's critical loads and guests on medical devices.",
      ],
    },
    ops: {
      immediate: [
        'Identify guests who rely on powered medical devices or refrigerated medication (oxygen, CPAP, insulin) and give them priority power or relocation.',
        'Confirm generators started and are carrying critical loads: life safety, refrigeration, well/booster pumps, IT and phones.',
      ],
      ongoing: [
        'Log walk-in cooler and freezer temperatures on a schedule, keep doors shut, and discard TCS food per the food code (above 41°F for over 4 hours).',
        'Check electronic door locks, access control, and room safes; post staff on exterior doors if access control fails.',
        'Check water pressure and hot water where wells, booster pumps, or lift stations need power; alert the IC at once if water service fails.',
      ],
      demob: [
        'Restore loads in stages, then check elevators, HVAC, kitchen equipment, and alarm panels before reopening areas to guests.',
      ],
    },
    planning: {
      ongoing: [
        'Track the earliest failure point (generator fuel, UPS or alarm batteries, cold-chain limits) and brief the IC on the time remaining.',
      ],
    },
    logistics: {
      immediate: [
        'Confirm generator fuel on hand and hours of run time at current load; schedule deliveries before tanks fall below half.',
      ],
      ongoing: [
        'Source rental generators, fuel, ice or dry ice, and refrigerated trailers as needed; confirm delivery routes are open.',
        'Set up device-charging stations and portable lighting for guests in a common area.',
      ],
    },
    finance: {
      ongoing: [
        'Document spoiled food and inventory with photos and temperature logs before disposal, for insurance or utility claims.',
      ],
    },
  }),

  // ── Water System ──────────────────────────────────────────────────────────
  'water-system': checklistItems('t-water-system', {
    ic: {
      immediate: [
        'Determine whether water is unsafe (boil-water, do-not-drink, or do-not-use notice) or unavailable, and who issued the notice or found the problem.',
        'Decide whether the property can operate without safe water for restrooms, kitchens, and fire sprinklers, or must reduce occupancy or close.',
      ],
      ongoing: [
        "Reassess occupancy each operational period against water on hand, sanitation capacity, and the regulator's expected lift date.",
      ],
    },
    'gsoc-support': {
      immediate: [
        "Find the water provider's or health department's notice (zones, issue time, reason) via alerts and OSINT/news, and log it.",
        'Check which other company properties share the water system or notice area and alert those GMs.',
        'If flooding, freezing, or a storm is the cause, watch Rivers & Floods, NWS Alerts, and radar for continuing threats to wells, pumps, and treatment.',
      ],
      ongoing: [
        "Track sampling results and the health department's lift criteria, and log when the notice is expected to be lifted.",
      ],
      demob: [
        'Log the official lift (issuer, time, zones) and confirm the property finished flushing before anyone announces the water is safe.',
      ],
    },
    safety: {
      immediate: [
        'If water pressure is lost, confirm sprinkler status with the fire-protection vendor, notify the fire department, and post a fire watch.',
      ],
      ongoing: [
        'Keep people out of sewage backups; cleanup requires PPE and a qualified sanitation contractor.',
        'Log guest or staff reports of stomach illness (vomiting, diarrhea) and pass them to the health department.',
      ],
    },
    pio: {
      immediate: [
        'Give guests written notice of what the order means (no tap water for drinking, ice, or brushing teeth), where to get water, and when updates come.',
      ],
    },
    liaison: {
      immediate: [
        'Contact the water system operator (municipal utility, park agency, or on-site operator) and the health department to confirm the order and requirements.',
      ],
      ongoing: [
        'If the property runs its own public water system, coordinate required public notice, sampling, and reporting with the state drinking-water program.',
      ],
    },
    ops: {
      immediate: [
        "Post 'Do not drink' signs at taps, bag drinking fountains, and shut off ice machines, beverage dispensers, and coffee makers on the tap supply.",
        'Switch kitchens to bottled or boiled water for cooking, handwashing, and ware-washing per health department guidance; pull dishes that need tap water.',
      ],
      ongoing: [
        'Stock bottled water in guest rooms and public areas and put hand sanitizer at restrooms, dining areas, and entrances.',
        'If toilets cannot flush, close affected restrooms and direct guests to portable toilets and handwashing stations.',
      ],
      demob: [
        'After the lift, flush building lines, ice machines, water heaters, and beverage lines and change filters per utility guidance before reuse.',
      ],
    },
    planning: {
      ongoing: [
        'Calculate daily water demand (guests, staff, kitchen) against supply on hand and forecast orders through the expected lift date.',
      ],
    },
    logistics: {
      immediate: [
        'Order bottled water (at least 1 gallon per person per day plus kitchen needs) and bagged ice from an approved outside source.',
      ],
      ongoing: [
        'Arrange potable water tanker delivery, portable toilets, and handwashing stations if the outage will last more than a day.',
      ],
    },
    finance: {
      ongoing: [
        'Track bottled water, portable sanitation, disposable serviceware, and discarded food and ice as incident costs.',
      ],
    },
  }),

  // ── IT / Comms Outage ─────────────────────────────────────────────────────
  'it-comms': checklistItems('t-it-comms', {
    ic: {
      immediate: [
        'Rule out a cyberattack (ransom note, many systems failing at once, unusual logins); if one is suspected, have GSOC change the type to Cyber Incident.',
      ],
      ongoing: [
        "Decide which services run manually and which are suspended (check-in, charging, tours, reservations) based on IT's restoration estimate.",
      ],
    },
    'gsoc-support': {
      immediate: [
        'Test and log which channels reach the property (landline, cell, email, radio, satellite phone) and agree on a primary and backup.',
        'Check carrier and vendor status pages, OSINT/news, and the Power Outages layer for a wider carrier, cloud, or power cause.',
        'Set a fixed check-in schedule with the property on the backup channel (e.g., satellite phone hourly) and log each check-in.',
      ],
      ongoing: [
        'Check whether other properties or corporate systems depend on the failed service (network, PMS, phone carrier) and warn them.',
        'Relay urgent calls and messages for the property (reservations, arrivals, agencies) while its lines are down.',
      ],
      demob: [
        'Test each restored channel with a call or message from the GSOC before ending the backup check-in schedule.',
      ],
    },
    safety: {
      immediate: [
        'Confirm guests can still reach 911 and that fire alarm monitoring and elevator phones work; post staff or a fire watch where they do not.',
      ],
    },
    pio: {
      immediate: [
        'Tell guests which services are affected (Wi-Fi, phones, card payments) and how to reach the front desk or emergency help meanwhile.',
      ],
    },
    liaison: {
      immediate: [
        "Tell local emergency dispatch the property's phones or alarm monitoring are down and give them a working alternate contact.",
      ],
    },
    ops: {
      immediate: [
        'Start PMS downtime procedures: pull the latest in-house, arrivals, departures, and room-status reports from the backup workstation or last print.',
        'Switch outlets to offline or manual POS (paper checks, offline card mode) and record charges for posting after restoration.',
        'If key cards cannot be encoded, issue emergency or master keys under controlled sign-out and log every key.',
      ],
      ongoing: [
        'Issue radios to key posts (front desk, security, engineering, manager on duty) and use runners for messages between buildings.',
      ],
      demob: [
        'Post all manual charges, check-ins, and room moves into the PMS/POS and reconcile them against paper records.',
      ],
    },
    planning: {
      ongoing: [
        'Keep a status board of each failed system with its workaround, owner, and restoration estimate for the IC.',
      ],
    },
    logistics: {
      immediate: [
        'Deploy backup communications (charged radios and spare batteries, satellite phones, cellular hotspots) and record who holds each.',
      ],
      ongoing: [
        'Coordinate IT and the carrier or vendor for on-site technicians, replacement hardware, or a temporary cellular/satellite circuit.',
      ],
    },
    finance: {
      ongoing: [
        'Store any manually captured card data securely per PCI rules, process it promptly, and destroy it after posting.',
      ],
    },
  }),

  // ── Cyber Incident ────────────────────────────────────────────────────────
  cyber: checklistItems('t-cyber', {
    ic: {
      immediate: [
        'Activate the cyber incident response plan with the IT security lead; have legal counsel engage the IR retainer firm so the work stays privileged.',
        'Direct that no one pays, negotiates with, or replies to a ransom or extortion demand without executive leadership and counsel approval.',
      ],
      ongoing: [
        'Approve containment steps that disrupt operations (taking systems offline, disconnecting properties) after hearing the business impact.',
        'Decide with counsel which notifications are required (law enforcement, card brands, regulators, guests, employees) and by when.',
      ],
    },
    'gsoc-support': {
      immediate: [
        'Move incident coordination off possibly compromised email and chat to the approved out-of-band channel (phone bridge or separate platform).',
        'Log each report of suspicious activity (who, system, time, what was seen) without forwarding suspicious emails, attachments, or links.',
        'Search OSINT/news and intel feeds for breach claims, leaked data, or a ransomware group naming the company or a property.',
      ],
      ongoing: [
        'Watch for phishing and fraud aimed at guests after the incident (fake refund emails, spoofed booking sites) and alert the PIO.',
        'If CCTV or access control is affected, alert property security to add patrols and staff key doors until it is restored.',
      ],
      demob: [
        'Move incident coordination back to regular email and chat only after IT confirms they are clean, and note that confirmation in the log.',
      ],
    },
    safety: {
      immediate: [
        'Confirm networked life-safety and building systems (fire alarm, elevators, building automation) still work; post staff or a fire watch where not.',
      ],
    },
    pio: {
      immediate: [
        "Hold all external statements for counsel's approval; do not call it a 'breach' or say no data was taken until forensics confirms.",
      ],
      ongoing: [
        'Prepare guest, employee, and partner notices and call-center scripts with counsel, ready for when notification is decided.',
      ],
    },
    liaison: {
      ongoing: [
        'Report to law enforcement (FBI field office or IC3; Secret Service for payment-card crime) as agreed with counsel, and log the case number.',
        'If payment card data may be involved, notify the acquiring bank/payment processor and engage a PCI Forensic Investigator if required.',
      ],
    },
    ops: {
      immediate: [
        'Disconnect affected devices from the network (cable out, Wi-Fi off) but do not power off, wipe, or reimage them; preserve evidence.',
        'Preserve logs, emails, and ransom notes and photograph screens; do not delete or change anything until the forensics team directs.',
      ],
      ongoing: [
        'Run affected properties on downtime procedures (paper reports, manual POS, emergency keys) while systems are isolated.',
        'Restore only from known-clean, offline backups after the response team confirms the attacker has been removed.',
      ],
      demob: [
        'Reconnect systems only after sign-off that patches, credential resets, MFA, and endpoint monitoring are in place.',
      ],
    },
    planning: {
      ongoing: [
        'Maintain the cyber timeline (first indicator, detection, containment, each notification) for counsel, forensics, and regulators.',
        'Track notification deadlines with counsel (state breach laws, GDPR 72 hours for EU guests, card-brand rules) and flag the earliest to the IC.',
      ],
    },
    logistics: {
      ongoing: [
        'Provide clean replacement laptops and phones and out-of-band communication tools for responders if company devices are compromised.',
      ],
    },
    finance: {
      immediate: [
        "Notify the cyber insurer within the policy's notice period and confirm its approved vendors (forensics, counsel, PR) before hiring others.",
      ],
      ongoing: [
        'Require call-back verification on any payment, payroll, or banking-detail change request during the incident (fraud risk).',
      ],
    },
  }),
};

export const FIRE_INFRA_TYPE_INTAKE: Record<string, IntakeBlockGroup[]> = {
  'structure-fire': [
    intakeGroup('t-structure-fire', 'Fire & Alarm', [
      'Which building, floor, and room or area is involved? Is there visible fire, smoke only, or an alarm with no fire found?',
      'Did the fire alarm activate and did sprinklers operate? Is the system still active, silenced, or shut off?',
      'Who is the fire department officer in charge, and where is their command post?',
      'Is the fire spreading or threatening adjacent buildings, vegetation, or wildland?',
    ]),
    intakeGroup('t-structure-fire-evac', 'Evacuation & Rooms', [
      'Has the affected building been fully evacuated? Are any rooms unchecked, or any guests needing help to evacuate?',
      'Where are evacuees assembled, and is that spot safe from smoke and clear of fire apparatus?',
      'How many guest rooms are out of service, and how many guests need relocation tonight?',
      'Is a source reported (kitchen, electrical, guest room, fireplace)? Record it as reported only; do not speculate.',
    ]),
  ],
  hazmat: [
    intakeGroup('t-hazmat', 'Material & Release', [
      'What material is involved (product name, placard or UN number, container label), or is it unknown?',
      'Where is the source: on property (pool room, kitchen, maintenance shop, fuel tank) or off site (rail, highway, neighboring facility)?',
      'Is the release ongoing? Is it a gas/vapor, liquid, or solid, and roughly how much?',
      'What are the wind direction and the buildings or areas downwind?',
    ]),
    intakeGroup('t-hazmat-exposure', 'Exposure & Protective Actions', [
      'Has anyone been exposed or reported symptoms (coughing, burning eyes, dizziness, nausea)? How many, and where are they now?',
      'Who ordered the protective action (property, fire department, emergency management), and are HVAC and air intakes shut off where people shelter?',
      'Is a Safety Data Sheet (SDS) available for the material?',
      'Has any material reached drains, waterways, or soil?',
    ]),
  ],
  'utility-outage': [
    intakeGroup('t-utility-outage', 'Outage Scope', [
      'Which utilities are out (electric, natural gas/propane, or several), and since what time?',
      'Is it one building, the whole property, or the surrounding area? Has the utility given a restoration estimate?',
      'Is a cause known (storm, utility equipment, planned or public-safety shutoff, on-site failure)?',
    ]),
    intakeGroup('t-utility-outage-impacts', 'Critical Systems & Guests', [
      'Are generators running, and how many hours of fuel remain at the current load?',
      'Is anyone trapped in an elevator?',
      'Are the fire alarm, emergency lighting, and other life-safety systems working?',
      'Are any guests dependent on powered medical devices or refrigerated medication?',
      'Are refrigeration, water pressure, heating/cooling, and door locks working?',
    ]),
  ],
  'water-system': [
    intakeGroup('t-water-system', 'Water Problem', [
      'What is the problem: no water, low pressure, discoloration or odor, confirmed contamination, sewage backup, or a pipe break/flooding?',
      'Is there a boil-water, do-not-drink, or do-not-use notice? Who issued it, and for which areas?',
      'What is the water source: municipal utility, park/agency system, or the property\'s own well and treatment system?',
      'Is anyone reporting illness (vomiting, diarrhea) that could be linked to the water?',
    ]),
    intakeGroup('t-water-system-ops', 'Operations Impact', [
      'Are restrooms, kitchens, laundry, or fire sprinklers affected?',
      'How much bottled water is on hand, and how many guests and staff need it?',
      'Has the kitchen stopped using tap water, ice machines, and beverage dispensers?',
      'What is the expected duration or lift date?',
    ]),
  ],
  'it-comms': [
    intakeGroup('t-it-comms', 'Systems Affected', [
      'Which systems are down: phones, internet/Wi-Fi, PMS, POS, key card encoding, radios, email, or reservations?',
      'When did it start, and does it affect one property, several, or the whole company?',
      'Is there any sign of a cyberattack (ransom message, locked files, unusual logins or pop-ups)?',
      'Is a cause known (power, carrier/ISP outage, cut cable, vendor/cloud outage, hardware failure)?',
    ]),
    intakeGroup('t-it-comms-fallback', 'Fallback & Safety', [
      'Can the property still call 911, and are fire alarm monitoring and elevator phones working?',
      'Are downtime procedures (paper reports, manual POS, emergency keys) in use?',
      'Are guests unable to get into rooms, pay, or check in or out?',
      "What is IT's or the vendor's estimate for restoration?",
    ]),
  ],
  cyber: [
    intakeGroup('t-cyber', 'Cyber Indicators', [
      'What was observed: ransom note, encrypted or locked files, suspicious login, phishing, a data-theft claim, or unusual system behavior?',
      'Which systems, devices, or accounts are affected (PMS, POS/payment, email, reservations, network, access control)?',
      'When was it first noticed, and by whom?',
      'Have affected devices been disconnected from the network (not powered off)?',
    ]),
    intakeGroup('t-cyber-data', 'Data & Notifications', [
      'Could guest, employee, or payment card data be involved?',
      'Has the attacker made contact (ransom demand, extortion, deadline)? Record it but do not reply.',
      'Have IT security, legal counsel, and the cyber insurer been notified?',
      'Are guest-facing operations affected (check-in, payments, reservations, door locks)?',
    ]),
  ],
};
