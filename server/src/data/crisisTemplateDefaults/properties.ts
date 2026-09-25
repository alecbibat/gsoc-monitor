// Property scope defaults — apply to EVERY incident at a property, whatever its
// type. Only what is specific to the place lives here: who has jurisdiction
// (NPS, state park, county, airport, flag state), the developed areas and
// people to account for, single access roads, comms gaps, seasonality and the
// hazards the site is known for. Generic ICS duties are in the General scope
// and hazard specifics in the types-*.ts files.
//
// Layer names match the map sidebar (NWS Alerts, Named Fires (NIFC), Wildfires
// (NASA FIRMS), Smoke, Air Quality, Lightning, Precipitation Radar, Wind,
// Earthquakes (USGS), Hurricanes, Rivers & Floods, Power Outages, Flights
// (ADS-B), Ships (AIS), News, Intel Feed, Property Watch).
//
// Ids are minted from list positions (see helpers.ts): once published, append
// new lines at the END of a list — never reorder or delete lines.
// Longest minted id: 'p-centennial-airport-gsoc-support-imm-NN' (40-41 chars).

import type { ChecklistBlockItem, IntakeBlockGroup } from '../../crisisTemplates/types';
import { checklistItems, intakeGroup } from './helpers';

// ── Glacier National Park (MT) ───────────────────────────────────────────────

const GLACIER = checklistItems('p-glacier', {
  ic: {
    immediate: [
      'Confirm with NPS whether park rangers hold command for this incident and set the company role (unified or supporting) accordingly.',
      'In shoulder season, confirm which lodges are open and staffed; closed lodges may have only caretakers or winterization crews on site.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Log Going-to-the-Sun Road, Many Glacier Road, US-2 and US-89 status from park road reports and NWS Alerts; flag closures on evacuation routes.',
      'Turn on Wildfires (NASA FIRMS), Named Fires, Smoke and Lightning for the park; Lake McDonald and Apgar sit in dense forest with few routes out.',
    ],
    ongoing: [
      'Keep a status board for each developed area (Many Glacier, Swiftcurrent, Lake McDonald, Apgar, Cedar Creek) with occupancy and road access.',
    ],
  },
  safety: {
    immediate: [
      'Place outdoor assembly areas away from bear activity and cold lake shores; keep them supervised and have staff carry bear spray.',
    ],
  },
  pio: {
    immediate: [
      'Coordinate every statement about an in-park incident with Glacier NP public affairs; the park speaks first on ranger-led operations.',
    ],
  },
  liaison: {
    immediate: [
      'Notify Glacier NP dispatch; for Many Glacier/Swiftcurrent also Blackfeet Nation law enforcement (access road crosses the reservation).',
      'For Cedar Creek Lodge (outside the park), notify Columbia Falls/Flathead County responders instead of NPS.',
    ],
  },
  ops: {
    immediate: [
      'Locate every Red Bus tour in progress (bus, driver, guest count, last position) and hold or turn back tours heading toward the affected area.',
      'Account for employees in each dormitory and housing area, including off-shift staff hiking or boating on their days off.',
    ],
  },
  planning: {
    immediate: [
      'Map evacuation routes by area: west side via Going-to-the-Sun Road to Apgar and US-2; Many Glacier via Many Glacier Road to Babb and US-89.',
    ],
  },
  logistics: {
    immediate: [
      'Confirm a working channel to Many Glacier and Swiftcurrent (landline, park radio, satellite phone); cell service there is limited or absent.',
    ],
  },
});

const GLACIER_INTAKE = [
  intakeGroup('p-glacier', 'Glacier National Park', [
    'Which location: Many Glacier Hotel, Swiftcurrent Motor Inn, Lake McDonald Lodge, Village Inn at Apgar, Cedar Creek Lodge, or a Red Bus tour/trail?',
    'Has Glacier NP dispatch been notified, and are park rangers on scene or en route?',
    'Are Going-to-the-Sun Road, Many Glacier Road, US-2 and US-89 open between the site and responders?',
    'Are any Red Bus tours, off-shift employees or guests in the backcountry potentially affected?',
    'Which communications are working at the site: cell, landline, park radio, satellite phone?',
  ]),
];

// ── Death Valley National Park (CA) — The Oasis at Death Valley ──────────────

const DEATH_VALLEY = checklistItems('p-death-valley', {
  ic: {
    immediate: [
      'Plan for long EMS response and transport times; request air ambulance early and confirm heat or wind limits on flights.',
      'In summer, treat loss of power or air conditioning at the Inn, Ranch or employee housing as a life-safety event; decide on cooling or relocation at once.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Log the current Furnace Creek temperature, forecast high and any NWS Extreme Heat, Flash Flood or High Wind warnings for the park.',
      'Watch Precipitation Radar over the surrounding mountains; flash floods reach Furnace Creek washes and close CA-190 without local rain.',
    ],
    ongoing: [
      'Track Power Outages and Air Quality (blowing dust) for Furnace Creek and CA-190, and confirm backup comms since cell coverage is minimal.',
    ],
  },
  safety: {
    immediate: [
      'Above 110°F, shelter guests in air-conditioned buildings rather than outdoor assembly points; stage water, shade and cooling for anyone outside.',
    ],
    ongoing: [
      'Set strict work/rest and hydration cycles for staff working outdoors and check road washouts before sending vehicles out.',
    ],
  },
  pio: {
    ongoing: [
      'Coordinate statements with Death Valley NP public affairs, especially for heat-related guest illness or death; never speculate on cause.',
    ],
  },
  liaison: {
    immediate: [
      'Notify Death Valley NP dispatch and the Inyo County Sheriff; confirm who holds command for the area involved.',
    ],
  },
  ops: {
    immediate: [
      'Account for guests out on day trips (Badwater, Dante\'s View, backcountry roads) using front desk, activity and trail-ride records.',
    ],
  },
  planning: {
    immediate: [
      'Map road access and alternates: CA-190 east and west, and the routes to Pahrump and Beatty; note any flood or heat-damage closures.',
    ],
  },
  logistics: {
    immediate: [
      'Confirm on-hand drinking water, ice, vehicle fuel and generator fuel at Furnace Creek; resupply may take many hours if roads close.',
    ],
  },
});

const DEATH_VALLEY_INTAKE = [
  intakeGroup('p-death-valley', 'Death Valley', [
    'Which area: The Inn at Death Valley, The Ranch at Death Valley, employee housing, or elsewhere in the park?',
    'What is the current temperature and forecast high, and are power and air conditioning working?',
    'Is CA-190 open in both directions, and are any roads closed by flooding or damage?',
    'Have Death Valley NP dispatch and the Inyo County Sheriff been notified, and is an air ambulance needed?',
    'How much drinking water, fuel and generator capacity is on hand?',
  ]),
];

// ── Grand Canyon (South Rim, Grand Canyon Railway & Hotel, Tusayan, Valle) ──

const GRAND_CANYON = checklistItems('p-grand-canyon', {
  ic: {
    immediate: [
      'Establish which entity is affected (South Rim lodges, Phantom Ranch, Grand Canyon Railway & Hotel, Tusayan hotels, Valle housing) and who leads on site.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Get the status of every Grand Canyon Railway train in service from railway operations: position on the line and passenger count.',
      'Check AZ-64 status between Williams, Valle, Tusayan and the South Rim, and the East Entrance route via Desert View; log any closures.',
    ],
    ongoing: [
      'Watch Lightning, NWS Alerts and Named Fires/Wildfires on the park and Kaibab National Forest; monsoon storms and prescribed burns are frequent.',
    ],
  },
  safety: {
    immediate: [
      'Keep assembly points and evacuation staging away from the rim edge and assign staff to control crowds near unprotected overlooks.',
    ],
    ongoing: [
      'Account for high elevation (about 7,000 ft) and inner-canyon heat in responder work plans; stage water for anyone hiking below the rim.',
    ],
  },
  pio: {
    immediate: [
      'Coordinate statements with Grand Canyon NP public affairs; the park leads on inner-canyon rescues, closures and fatalities.',
    ],
  },
  liaison: {
    immediate: [
      'Notify Grand Canyon NP dispatch for South Rim and inner-canyon incidents, Coconino County Sheriff for Tusayan/Valle, and Williams police for the railway hotel.',
    ],
  },
  ops: {
    immediate: [
      'Account for guests and staff below the rim (Phantom Ranch, mule trips, hikers) using reservations and mule-trip rosters; NPS runs inner-canyon evacuation.',
      'Account for employees in Grand Canyon Village and Valle employee housing and confirm staff transport if AZ-64 closes.',
    ],
  },
  logistics: {
    ongoing: [
      'Check South Rim water status with NPS (Transcanyon waterline breaks trigger conservation) before planning guest capacity or relocations.',
    ],
  },
});

const GRAND_CANYON_INTAKE = [
  intakeGroup('p-grand-canyon', 'Grand Canyon', [
    'Which site: a South Rim lodge (which one), Phantom Ranch/inner canyon, the Grand Canyon Railway (train, depot or hotel), a Tusayan hotel, or Valle housing?',
    'Is a Grand Canyon Railway train in service or affected? Where is it, and how many passengers are aboard?',
    'Are any guests or staff below the rim (mule trips, Phantom Ranch, hikers)?',
    'Is AZ-64 open between Williams, Valle, Tusayan and the South Rim, and is the East Entrance open?',
    'Have Grand Canyon NP dispatch, the Coconino County Sheriff or Williams police been notified?',
  ]),
];

// ── Corporate offices (Greenwood Village, CO HQ & Flagstaff, AZ) ─────────────

const CORPORATE = checklistItems('p-corporate', {
  ic: {
    immediate: [
      'Decide whether corporate functions (payroll, reservations support, IT, GSOC) move to remote work or an alternate site, and tell department heads.',
    ],
    ongoing: [
      'Confirm a delegation of authority if executives are affected, unreachable or traveling, and record who holds decision authority.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'If the building housing GSOC or core IT is affected, shift monitoring to remote operators or the alternate site before GSOC staff evacuate.',
      'Pull access-control badge-ins, visitor logs and hybrid schedules to build the accountability list of who is in the office.',
    ],
    ongoing: [
      'Watch NWS Alerts (hail, tornado, winter storm) for the Denver metro and Flagstaff and alert office managers before commute hours.',
    ],
  },
  safety: {
    immediate: [
      'Coordinate with building management on alarms, sprinklers, elevators and access control; do not re-occupy until fire or the landlord clears it.',
    ],
  },
  pio: {
    immediate: [
      'Send employees an office-status notice with work-from-home or report-to instructions and when the next update will come.',
    ],
  },
  liaison: {
    immediate: [
      'Notify building management/the landlord and coordinate with neighboring tenants and local police and fire in Greenwood Village or Flagstaff.',
    ],
  },
  ops: {
    immediate: [
      'Run floor-warden accountability at the building assembly point and report missing employees, visitors and contractors to GSOC.',
    ],
  },
  logistics: {
    immediate: [
      'Confirm server rooms and network closets, backup power, and VPN/remote-access capacity for staff working remotely.',
    ],
  },
  finance: {
    ongoing: [
      'Notify the landlord and property insurer of building damage and log business-interruption hours for corporate functions.',
    ],
  },
});

const CORPORATE_INTAKE = [
  intakeGroup('p-corporate', 'Corporate Office', [
    'Which office: Greenwood Village (headquarters) or Flagstaff?',
    'How many visitors are signed in, and has floor-warden accountability at the assembly point been completed?',
    'Has building management or the landlord been notified, and what do they report (alarms, elevators, access control)?',
    'Are critical corporate systems affected: IT/network, phones, reservations support, payroll, or GSOC?',
    'Should employees work remotely, and for how long?',
  ]),
];

// ── Centennial Airport (KAPA) — corporate hangar ─────────────────────────────

const CENTENNIAL_AIRPORT = checklistItems('p-centennial-airport', {
  ic: {
    immediate: [
      'Contact the Director of Aviation or chief pilot and confirm the flight department has activated its Emergency Response Plan.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Use Flights (ADS-B) to confirm which company aircraft are in the hangar, airborne or away from base, with destinations and ETAs.',
    ],
    ongoing: [
      'Watch NWS Alerts, Lightning, Wind and Precipitation Radar at KAPA and warn the flight department early enough to hangar aircraft before hail.',
    ],
  },
  safety: {
    immediate: [
      'Keep people out of the hangar if the fire-suppression foam system has discharged; foam can disorient and suffocate.',
      'Escort anyone without an airport badge on the ramp and keep non-essential people away from aircraft with fuel, oxygen or battery hazards.',
    ],
  },
  liaison: {
    immediate: [
      'Notify Centennial Airport operations and airport fire/ARFF for any event on the field, and the FBO or tower as needed.',
    ],
  },
  ops: {
    immediate: [
      'Account for flight crew, maintenance technicians, line staff, passengers and visitors using the hangar sign-in and trip manifests.',
    ],
  },
  planning: {
    ongoing: [
      'Review upcoming trips and decide with the flight department whether to relocate aircraft, use alternate airports, or cancel.',
    ],
  },
  logistics: {
    ongoing: [
      'Arrange alternate hangar or FBO space and ground transport for crews and passengers if the hangar is unusable.',
    ],
  },
  finance: {
    ongoing: [
      "Photograph aircraft and hangar damage and record each aircraft's maintenance status for the aviation insurer before repairs.",
    ],
  },
});

const CENTENNIAL_AIRPORT_INTAKE = [
  intakeGroup('p-centennial-airport', 'Centennial Airport Hangar', [
    'Is the event in the hangar, on the ramp or taxiway, or involving a company aircraft in flight?',
    'Which company aircraft (tail numbers) are in the hangar, airborne, or away from base right now?',
    'Who is at the hangar (crew, maintenance, passengers, visitors), and is everyone accounted for?',
    'Have airport operations, the tower and airport fire/ARFF been notified?',
    'Has the hangar fire-suppression (foam) system activated, and is fuel or other hazardous material involved?',
  ]),
];

// ── Yellowstone National Park (WY/MT/ID) ─────────────────────────────────────

const YELLOWSTONE = checklistItems('p-yellowstone', {
  'gsoc-support': {
    immediate: [
      'Identify the developed area(s) affected and pull guest occupancy and employee dormitory counts for each.',
      'Log park road segment and entrance status; note drive times between developed areas, since responders may be an hour or more away.',
    ],
    ongoing: [
      'Watch Earthquakes (USGS) around the Yellowstone caldera and relay any USGS Yellowstone Volcano Observatory notices to the IC.',
      'During spring runoff, watch Rivers & Floods gauges on the Yellowstone River (e.g., Corwin Springs); 2022 flooding cut off Gardiner and northern roads.',
    ],
  },
  safety: {
    immediate: [
      'Keep evacuees, staging areas and vehicles off hydrothermal ground; the crust can be thin over scalding water.',
      'Check outdoor assembly and staging areas for bison, elk or bears before sending people there, and name an indoor alternate; bison often bed in developed areas.',
    ],
  },
  pio: {
    immediate: [
      'Clear every statement with Yellowstone NP public affairs; the park announces closures, rescues and deaths inside the park.',
    ],
  },
  liaison: {
    immediate: [
      'Notify Yellowstone NP dispatch; NPS rangers provide law enforcement, EMS and structural fire response inside the park.',
      'For Gardiner incidents outside the park, notify the Park County (MT) Sheriff and local fire/EMS.',
    ],
  },
  ops: {
    immediate: [
      'Account for guests on company activities (bus tours, Roosevelt trail rides and cookouts, Lake boat tours) and staff on days off.',
    ],
    ongoing: [
      'In winter, plan any Old Faithful Snow Lodge evacuation by snowcoach or snowmobile; interior roads are closed to cars.',
    ],
  },
  planning: {
    ongoing: [
      'Plan housing and meals for employees displaced from dormitories and identify which developed areas can absorb relocated guests.',
    ],
  },
});

const YELLOWSTONE_INTAKE = [
  intakeGroup('p-yellowstone', 'Yellowstone National Park', [
    'Which area: Mammoth, Old Faithful, Canyon, Lake, Grant, Roosevelt, a campground (e.g., Madison), Gardiner, or a park road?',
    'Has Yellowstone NP dispatch been notified, and are rangers on scene or en route?',
    'Which park roads and entrances are open between the site and the nearest hospital or staging area?',
    'Are campers or employee-dormitory residents in the affected area, and how many?',
    'Are hydrothermal ground, wildlife, or snow and seasonal road closures complicating access or evacuation?',
  ]),
];

// ── Mount Rushmore National Memorial (SD) — memorial concessions ─────────────

const RUSHMORE = checklistItems('p-rushmore', {
  'gsoc-support': {
    immediate: [
      'Scan News and the Intel Feed for threats, protests or VIP visits involving the memorial, and note the expected crowd for the day.',
    ],
    ongoing: [
      'Watch NWS Alerts, Lightning and Wildfires around the Black Hills; the memorial sits in ponderosa forest with limited road access.',
    ],
  },
  safety: {
    immediate: [
      'Keep egress from the restaurant, gift shop and terrace clear, and follow NPS direction on crowd movement during evacuation.',
    ],
  },
  pio: {
    immediate: [
      'Route media questions about the memorial to NPS public affairs; company statements cover only concession operations and staff.',
    ],
  },
  liaison: {
    immediate: [
      'Notify memorial rangers/NPS dispatch for incidents on the grounds, and the Pennington County Sheriff and Keystone fire/EMS for incidents off site.',
    ],
  },
  ops: {
    immediate: [
      'Shelter or evacuate the dining, gift and ice-cream outlets as NPS directs, and account for every concession employee on shift.',
    ],
  },
  planning: {
    immediate: [
      'Map traffic and evacuation routes via SD-244 to Keystone and Hill City and the parking-structure exits, and share them with NPS.',
    ],
  },
  logistics: {
    ongoing: [
      'Arrange staff transport if SD-244 or US-16A is closed at shift change, and restock water and supplies for sheltered visitors.',
    ],
  },
  finance: {
    ongoing: [
      'Record closure hours and lost concession revenue for reporting to NPS under the concession contract.',
    ],
  },
});

const RUSHMORE_INTAKE = [
  intakeGroup('p-rushmore', 'Mount Rushmore', [
    'Where at the memorial: restaurant, gift shop, ice-cream shop, terrace/Avenue of Flags, parking structure, or trails?',
    'Have memorial rangers/NPS dispatch been notified, and are they on scene?',
    'About how many visitors are at the memorial now, and is a special event, protest or VIP visit under way?',
    'Is SD-244 open toward Keystone and Hill City?',
    'How many concession employees are on shift, and are all accounted for?',
  ]),
];

// ── Custer State Park (SD) ───────────────────────────────────────────────────

const CUSTER = checklistItems('p-custer', {
  'gsoc-support': {
    immediate: [
      'Pull guest and staff counts for each lodge (Sylvan Lake, Blue Bell, Legion Lake, State Game Lodge) and flag which are affected.',
      'Log Needles Highway, Wildlife Loop, Iron Mountain Road and US-16A status; narrow tunnels and switchbacks limit buses and large vehicles.',
    ],
    ongoing: [
      'Watch Wildfires (NASA FIRMS), Named Fires, Wind and Lightning across the Black Hills; park forest and grassland burn fast (2017 Legion Lake Fire).',
    ],
  },
  safety: {
    immediate: [
      'Keep evacuees and staging areas clear of the bison herd and burros; never route guests on foot through wildlife areas.',
    ],
  },
  pio: {
    ongoing: [
      'Coordinate statements with South Dakota Game, Fish & Parks communications; the state announces park and road closures.',
    ],
  },
  liaison: {
    immediate: [
      'Notify Custer State Park staff (SD Game, Fish & Parks) and the Custer County Sheriff; state park officers, not NPS, have jurisdiction here.',
    ],
  },
  ops: {
    immediate: [
      'Account for guests on trail rides, chuckwagon cookouts, jeep tours and water rentals, and bring them back to the lodges.',
    ],
    ongoing: [
      'During the Buffalo Roundup and peak summer weekends, coordinate crowd, traffic and parking control with park staff.',
    ],
  },
  planning: {
    immediate: [
      'Map evacuation by lodge: which roads lead to Custer, Hermosa or Keystone, and where evacuated guests will be received.',
    ],
  },
  logistics: {
    immediate: [
      'Confirm radio or landline backup at lodges with weak cell coverage and assign a runner if comms fail.',
    ],
  },
});

const CUSTER_INTAKE = [
  intakeGroup('p-custer', 'Custer State Park', [
    'Which lodge or area: Sylvan Lake, Blue Bell, Legion Lake, State Game Lodge, or a park road or activity?',
    'Have Custer State Park staff (SD Game, Fish & Parks) and the Custer County Sheriff been notified?',
    'Are Needles Highway, Wildlife Loop Road and US-16A open to the site?',
    'Are guests out on trail rides, jeep tours, hikes or water activities, and how many?',
    'Is a special event (e.g., Buffalo Roundup) or peak-season crowd under way?',
  ]),
];

// ── Windstar Cruises — Miami shore office (fleet operations, DPA) ────────────

const WINDSTAR = checklistItems('p-windstar', {
  ic: {
    immediate: [
      'Establish whether the incident affects the Miami office, a ship, or both; for a ship, activate the shore-side emergency team with the DPA.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Check Ships (AIS) for the whole fleet and flag any ship near the incident area or bound for an affected port.',
      'Check Hurricanes and NWS Alerts for South Florida; in hurricane season, track office-closure triggers and remote-work readiness.',
    ],
    ongoing: [
      "Keep a fleet board in the Action Log: each ship's position, next port and status relative to the incident, updated on every change.",
    ],
  },
  pio: {
    immediate: [
      'Align guest, family and travel-advisor communications with reservations and guest services, and stand up family assistance if guests are affected.',
    ],
  },
  liaison: {
    immediate: [
      'Notify local police and fire for office incidents; for fleet incidents, confirm the DPA is handling flag-state, USCG and port-agent contacts.',
    ],
  },
  ops: {
    immediate: [
      'Account for office employees and visitors, and confirm 24/7 fleet support (DPA, marine operations, guest services) can run remotely.',
    ],
  },
  planning: {
    ongoing: [
      'Review upcoming embarkations and itineraries in the affected region and prepare reroute, delay or cancel options with marine operations.',
    ],
  },
  logistics: {
    immediate: [
      'Confirm backup power and remote access for reservations, crew scheduling and ship-to-shore communications.',
    ],
  },
  finance: {
    ongoing: [
      'Track fleet-related costs (diversions, guest compensation, crew changes) separately from office costs.',
    ],
  },
});

const WINDSTAR_INTAKE = [
  intakeGroup('p-windstar', 'Windstar Shore Office', [
    'Does the incident involve the Miami office, one or more ships, or both?',
    'Has the Designated Person Ashore (DPA) been notified, and is the shore-side emergency team activated?',
    'Which ships, itineraries or embarkation ports are affected?',
    'How many office employees and visitors are on site, and are all accounted for?',
    'Can reservations, guest services and marine operations continue remotely if the office closes?',
  ]),
];

// ── Holiday Vacations — escorted motorcoach tours ────────────────────────────

const HOLIDAY = checklistItems('p-holiday', {
  ic: {
    immediate: [
      'Decide for each affected tour whether to hold in place, reroute, or end the tour early, and confirm the decision with the tour director.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'List every tour operating in or heading to the affected area: tour and departure date, tour director, motorcoach operator and guest count.',
      "Log each tour director's last check-in and location, and set a check-in schedule for every affected group; escalate any missed check-in.",
    ],
    ongoing: [
      "Watch NWS Alerts, road closures, News and the Intel Feed along each affected tour's remaining route and brief tour directors on changes.",
    ],
  },
  safety: {
    immediate: [
      'Confirm the motorcoach is safe to move (weather, road closures, driver fatigue); never ask a driver to exceed hours-of-service limits.',
    ],
  },
  pio: {
    ongoing: [
      "Reach affected guests' emergency contacts through guest services and tell travel advisors about itinerary changes.",
    ],
  },
  liaison: {
    immediate: [
      "Contact the motorcoach operator's dispatch for driver status, vehicle location and remaining hours of service.",
    ],
  },
  ops: {
    immediate: [
      'Have tour directors hold groups at a safe location (hotel, attraction) and account for every guest, including those on free time or optional tours.',
    ],
    ongoing: [
      "For an ill or injured guest, confirm the hospital and condition, support the traveling companion, and assign a staff contact to the family.",
    ],
  },
  planning: {
    ongoing: [
      'Review departures to the affected region over the next 14 days and recommend proceed, modify or cancel.',
    ],
  },
  logistics: {
    ongoing: [
      'Book alternate hotels, meals and transport for stranded or rerouted groups through tour operations and approved vendors.',
    ],
  },
  finance: {
    ongoing: [
      'Track refunds, extra nights and vendor penalties by tour departure for travel-protection and insurance claims.',
    ],
  },
});

const HOLIDAY_INTAKE = [
  intakeGroup('p-holiday', 'Holiday Vacations Tour', [
    'Which tour(s): tour name, departure date, and current day of the itinerary?',
    'Where is the group now, and where is it scheduled to be next?',
    'How many guests are on the tour, and who are the tour director and motorcoach operator?',
    'Are all guests accounted for, including those on free time or optional tours?',
    'Has the tour director contacted local emergency services or the hotel?',
  ]),
];

// ── VBT Bicycling Vacations — guided & self-guided bike tours (US & abroad) ─

const VERMONT = checklistItems('p-vermont', {
  ic: {
    immediate: [
      'Decide whether to pause, reroute or end the affected tour, weighing rider safety over the remaining itinerary.',
    ],
  },
  'gsoc-support': {
    immediate: [
      "Identify every tour in the affected area: country, dates, trip leaders, support van and rider count; flag riders on self-guided trips.",
      "Check today's route against hazard layers (NWS Alerts in the US, Lightning, Wildfires, Air Quality, heat) and alert trip leaders.",
    ],
    ongoing: [
      'For tours abroad, check the State Department travel advisory, local news and the Intel Feed, and note the local emergency number.',
      'Hold trip-leader check-ins at set times (ride start, midday, arrival) until the hazard passes; escalate any missed check-in.',
    ],
  },
  safety: {
    immediate: [
      'Suspend riding for lightning, extreme heat, AQI above 150 or unsafe roads, and shuttle riders in the support van.',
    ],
  },
  pio: {
    ongoing: [
      "Contact riders' emergency contacts only as the rider wishes; never release rider names or medical details.",
    ],
  },
  liaison: {
    immediate: [
      "Abroad, contact the local ground operator and, for a rider in serious trouble, the nearest embassy or consulate of the rider's country.",
    ],
  },
  ops: {
    immediate: [
      'Have trip leaders stop the ride, gather riders at the nearest safe point (van, hotel, town) and do a headcount; riders may be miles apart.',
      'For a rider crash or medical event, confirm EMS response, hospital, rider condition and who stays with the rider.',
    ],
  },
  planning: {
    ongoing: [
      'Review upcoming departures to the affected region or country and recommend proceed, reroute or cancel.',
    ],
  },
  logistics: {
    ongoing: [
      'Arrange rider transport (support van, taxi, local transfers) and replacement bikes or gear; confirm support-van locations and fuel.',
    ],
  },
  finance: {
    ongoing: [
      'Open travel-insurance and medical-assistance cases for affected riders and track medical, evacuation and rebooking costs.',
    ],
  },
});

const VERMONT_INTAKE = [
  intakeGroup('p-vermont', 'VBT Bike Tour', [
    "Which tour(s): tour name, country/region, departure dates, and today's route segment?",
    'Who are the trip leaders, and how can they be reached (mobile, messaging app, satellite device)?',
    'How many riders are on the tour, and are all accounted for right now, including riders ahead on the route or on self-guided trips?',
    'For tours abroad: which local ground operator supports the tour, and has the travel medical-assistance provider been contacted?',
    'Is anyone injured, and if so, where are they being treated?',
  ]),
];

// ── Sea Island Resort (GA barrier island) ────────────────────────────────────

const SEA_ISLAND = checklistItems('p-sea-island', {
  ic: {
    immediate: [
      'Follow Glynn County and state evacuation orders, and set the resort\'s own guest-departure decision ahead of tropical-storm winds and causeway closure.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Check Hurricanes and NWS Alerts (tropical, coastal flood, rip current) for the Glynn County coast; log arrival time of tropical-storm-force winds.',
    ],
    ongoing: [
      'Watch NWS coastal flood warnings, Power Outages and county re-entry status after a storm and relay each change to the IC.',
    ],
  },
  safety: {
    immediate: [
      'Clear beaches, pools and golf courses at the first lightning, keep swimmers out during rip current warnings, and set beach flags to match.',
    ],
  },
  pio: {
    ongoing: [
      'Coordinate messages to members, cottage owners, and booked or arriving guests, and align storm timing with county announcements.',
    ],
  },
  liaison: {
    immediate: [
      'Notify Glynn County police, fire and emergency management; for water incidents also the USCG and Georgia DNR.',
    ],
  },
  ops: {
    immediate: [
      'Account for guests and staff at The Cloister, The Lodge, the Beach Club, rental cottages and golf courses, and anyone on the beach or water.',
    ],
    ongoing: [
      'Before landfall, secure outdoor furniture, golf carts, boats and loose items, and name a post-storm damage-assessment and re-entry team.',
    ],
  },
  planning: {
    immediate: [
      'Track the Sea Island causeway and F.J. Torras Causeway and plan guest and staff movements before surge or wind closes them.',
    ],
  },
  finance: {
    ongoing: [
      'Photograph buildings, grounds and shoreline before and after a storm and track costs against the named-storm deductible.',
    ],
  },
});

const SEA_ISLAND_INTAKE = [
  intakeGroup('p-sea-island', 'Sea Island Resort', [
    'Which area: The Cloister, The Lodge, the Beach Club, rental cottages, golf courses, the beach or water, or the causeway?',
    'Are the Sea Island causeway and the F.J. Torras Causeway open, and is an evacuation order in effect for Glynn County?',
    'Is anyone on the beach, in the water, or on the golf courses right now?',
    'What are the current tide, wind, and surf or rip current conditions?',
    'How many guests, members and cottage residents are on the island and would need to leave over the causeways?',
  ]),
];

// ── Pikes Peak Cog Railway (Manitou Springs, CO — summit ~14,115 ft) ────────

const COG_RAILWAY = checklistItems('p-cog-railway', {
  ic: {
    ongoing: [
      'Before resuming service, get weather and track-inspection clearance and make a go/no-go call for each departure.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Get the position of every train (depot, en route location, summit) and its passenger count from Cog Railway operations.',
      'Watch Lightning and Precipitation Radar over the summit and alert operations before storm cells reach the peak.',
    ],
    ongoing: [
      'Watch NWS Flash Flood Warnings and Precipitation Radar over Ruxton Creek and Manitou Springs; heavy rain upslope can flood the canyon and the depot.',
    ],
  },
  safety: {
    immediate: [
      'During lightning, shelter summit passengers inside the summit visitor center or train cars and clear the summit platform.',
      'Move guests with altitude sickness or hypothermia to lower elevation promptly (next train down or by vehicle on the Pikes Peak Highway).',
    ],
  },
  liaison: {
    immediate: [
      'Notify Manitou Springs fire/police for the depot, El Paso County Sheriff for the line, and the summit operator and USFS for summit incidents.',
    ],
  },
  ops: {
    immediate: [
      'If a train stops on the grade, keep passengers aboard unless in immediate danger; evacuate off-train only with rescue support on steep, roadless terrain.',
      'Account for all passengers by train and ticket manifest, and for crew at the depot, aboard trains and at the summit.',
    ],
  },
  logistics: {
    immediate: [
      'Arrange buses or vans to bring passengers down the Pikes Peak Highway if trains cannot run, and confirm the highway is open.',
    ],
  },
  finance: {
    ongoing: [
      'Record cancelled departures and refunded tickets by train and date, and the cost of any highway shuttles used to bring passengers down.',
    ],
  },
});

const COG_RAILWAY_INTAKE = [
  intakeGroup('p-cog-railway', 'Pikes Peak Cog Railway', [
    'Where is the incident: the Manitou Springs depot, a train en route (which train, approximate location), or the summit?',
    'How many passengers and crew are on each affected train or at the summit?',
    'Is anyone showing signs of altitude sickness, hypothermia, or other medical distress?',
    'What are summit conditions now: lightning, wind, temperature, snow and visibility?',
    'Is the Pikes Peak Highway open for vehicles to reach the summit?',
  ]),
];

// ── Rocky Mountain National Park (CO) ────────────────────────────────────────

const ROCKY_MOUNTAIN = checklistItems('p-rocky-mountain', {
  'gsoc-support': {
    immediate: [
      'Log Trail Ridge Road status (seasonal or weather closure) and whether company staff at sites along it, such as the Alpine Visitor Center, can get down.',
    ],
    ongoing: [
      'Watch Lightning and Precipitation Radar over Trail Ridge Road; afternoon storms put people above treeline at risk, so alert the site early.',
      'Watch Wildfires (NASA FIRMS), Named Fires and Smoke for the park and Estes Park; 2020 wildfires forced evacuations on both sides of the park.',
    ],
  },
  safety: {
    immediate: [
      'Watch for altitude illness and cold exposure among guests and staff above 11,000 ft and move anyone affected to lower elevation.',
    ],
  },
  pio: {
    ongoing: [
      'Coordinate statements with Rocky Mountain NP public affairs; the park announces closures and Trail Ridge Road status.',
    ],
  },
  liaison: {
    immediate: [
      'Notify Rocky Mountain NP dispatch for in-park incidents; for the Estes Park offices, Estes Park police or the Larimer County Sheriff and Estes Valley Fire.',
    ],
  },
  ops: {
    immediate: [
      'Account for employees at the offices and any in-park sites, including seasonal staff and anyone in employee housing.',
    ],
  },
  planning: {
    immediate: [
      'Plan routes down and out: US-34/US-36 east to Estes Park, or west over Trail Ridge to Grand Lake when the road is open.',
    ],
  },
  logistics: {
    immediate: [
      'Confirm radio or satellite-phone backup for staff working along Trail Ridge Road, where cell coverage is poor.',
    ],
  },
});

const ROCKY_MOUNTAIN_INTAKE = [
  intakeGroup('p-rocky-mountain', 'Rocky Mountain National Park', [
    'Where is the incident: the Estes Park offices, a site along Trail Ridge Road (e.g., the Alpine Visitor Center), or elsewhere in the park?',
    'Have Rocky Mountain NP dispatch (in the park) or local police / Larimer County Sheriff (Estes Park) been notified?',
    'Is Trail Ridge Road open, and are the Beaver Meadows, Fall River and Grand Lake entrances open?',
    'How many guests and employees are at the site, and is anyone above treeline?',
    'What are current conditions: lightning, wind, snow or smoke?',
  ]),
];

// ── Windstar ships at sea (Master = on-scene commander; DPA ashore) ─────────

const WINDSTAR_SHIPS = checklistItems('p-windstar-ships', {
  ic: {
    immediate: [
      'Recognize the Master as on-scene commander with overriding authority aboard; the shore IC supports through the DPA and does not direct the ship.',
    ],
  },
  'gsoc-support': {
    immediate: [
      "Record each affected ship's last port, next port and ETA, and guest and crew counts from the onboard manifest.",
      'Scan News, the Intel Feed and travel advisories for the next ports (unrest, strikes, disease outbreaks, port closures) and brief the DPA.',
    ],
    ongoing: [
      'Set a fixed ship-to-shore reporting schedule with the bridge through the DPA and log each report and any missed check-in.',
    ],
  },
  safety: {
    immediate: [
      "Confirm the ship's medical center capacity (doctor, nurse, supplies) and whether shoreside medical support or evacuation is needed.",
    ],
  },
  pio: {
    ongoing: [
      'Watch guest social media posts from the ship and keep shoreside statements consistent with what guests are told onboard.',
    ],
  },
  liaison: {
    immediate: [
      'Through the DPA, get local emergency services, hospital, immigration and quarantine contacts from the port agent at the next port.',
    ],
  },
  ops: {
    immediate: [
      'Confirm who is ashore on shore excursions or crew leave and, through the port agent, that every group is returning or accounted for.',
    ],
    ongoing: [
      'Track crew welfare and notify crew families through crew HR and manning agencies when crew members are affected.',
    ],
  },
  logistics: {
    immediate: [
      'Confirm ship-to-shore communications (satellite phone, email, data link) and a backup path if the primary fails.',
    ],
  },
  finance: {
    ongoing: [
      'Record onboard and future-cruise credits issued for itinerary changes by ship and voyage, and confirm the compensation offer with guest services.',
    ],
  },
});

const WINDSTAR_SHIPS_INTAKE = [
  intakeGroup('p-windstar-ships', 'Windstar Ships', [
    'Which ship(s) are involved, and what are the current position, last port and next port?',
    'Are any guests or crew ashore on shore excursions or leave? How many, and where?',
    'Has the Master reported the incident to the DPA, and what is the ship\'s current security (ISPS) level?',
    'Can the ship still call at its next port (port open, weather, strikes, unrest, health restrictions)? If not, what is the alternate?',
    'Does the ship need shoreside support: medical, port agent, provisioning, or an itinerary change?',
  ]),
];

// ── Exports ──────────────────────────────────────────────────────────────────

export const PROPERTY_CHECKLISTS: Record<string, ChecklistBlockItem[]> = {
  glacier: GLACIER,
  'death-valley': DEATH_VALLEY,
  'grand-canyon': GRAND_CANYON,
  corporate: CORPORATE,
  'centennial-airport': CENTENNIAL_AIRPORT,
  yellowstone: YELLOWSTONE,
  rushmore: RUSHMORE,
  custer: CUSTER,
  windstar: WINDSTAR,
  holiday: HOLIDAY,
  vermont: VERMONT,
  'sea-island': SEA_ISLAND,
  'cog-railway': COG_RAILWAY,
  'rocky-mountain': ROCKY_MOUNTAIN,
  'windstar-ships': WINDSTAR_SHIPS,
};

export const PROPERTY_INTAKE: Record<string, IntakeBlockGroup[]> = {
  glacier: GLACIER_INTAKE,
  'death-valley': DEATH_VALLEY_INTAKE,
  'grand-canyon': GRAND_CANYON_INTAKE,
  corporate: CORPORATE_INTAKE,
  'centennial-airport': CENTENNIAL_AIRPORT_INTAKE,
  yellowstone: YELLOWSTONE_INTAKE,
  rushmore: RUSHMORE_INTAKE,
  custer: CUSTER_INTAKE,
  windstar: WINDSTAR_INTAKE,
  holiday: HOLIDAY_INTAKE,
  vermont: VERMONT_INTAKE,
  'sea-island': SEA_ISLAND_INTAKE,
  'cog-railway': COG_RAILWAY_INTAKE,
  'rocky-mountain': ROCKY_MOUNTAIN_INTAKE,
  'windstar-ships': WINDSTAR_SHIPS_INTAKE,
};
