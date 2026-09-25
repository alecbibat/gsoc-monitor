// Incident-type scope defaults — Natural Hazards (wildfire, hurricane, severe
// weather, winter storm, flood, earthquake, wildlife).
//
// Only what is specific to the hazard lives here; generic ICS duties are in
// the General scope and property specifics in properties.ts. Layer names
// match the map sidebar (NWS Alerts, Named Fires (NIFC), Air Quality, Rivers &
// Floods, Hurricanes, Lightning, Power Outages, Ships (AIS), …).
//
// Ids are minted from list positions (see helpers.ts): once published, append
// new lines at the END of a list — never reorder or delete lines.

import type { ChecklistBlockItem, IntakeBlockGroup } from '../../crisisTemplates/types';
import { checklistItems, intakeGroup } from './helpers';

// ── Wildfire ─────────────────────────────────────────────────────────────────

const WILDFIRE = checklistItems('t-wildfire', {
  ic: {
    immediate: [
      "Agree on evacuation trigger points (fire distance, spread direction, wind shift) with the fire agency and set the property's Ready/Set/Go status.",
      "Decide whether to hold, divert or cancel arrivals, tours and events while the fire's direction and road status are uncertain.",
    ],
  },
  'gsoc-support': {
    immediate: [
      'Turn on Named Fires (NIFC), Wildfires (NASA FIRMS), Wind and NWS Alerts at the property; log distance and bearing to the nearest fire edge.',
      'Open the property in Property Watch, widen the radius to cover its evacuation routes, and report each new hotspot or Red Flag Warning.',
    ],
    ongoing: [
      'Report perimeter growth, acreage, containment and distance to the property to the IC at every perimeter update.',
      'Watch the Smoke and Air Quality layers at the property and alert Safety when AQI crosses 100, 150 and 200.',
      'Monitor Lightning and wind forecasts for new starts or wind shifts near evacuation routes and alert Operations immediately.',
      'Track Power Outages for utility safety shutoffs (PSPS) and OSINT/news for evacuation-zone changes; relay each change to the IC.',
    ],
    demob: [
      'Keep checking the property in Property Watch for new hotspots and flare-ups until the agency reports that flank of the fire contained.',
    ],
  },
  safety: {
    immediate: [
      'Confirm no employee engages the wildfire; staff withdraw at the agreed trigger and leave suppression to fire agencies.',
    ],
    ongoing: [
      'Issue N95s to outdoor staff above AQI 150, move non-essential outdoor work indoors above 200, and check on guests with respiratory conditions.',
    ],
    demob: [
      'Walk the property before re-entry for hot spots, ash pits, fire-weakened trees, downed lines and possible water-system contamination.',
    ],
  },
  pio: {
    immediate: [
      "Match guest evacuation messages to the agency's current order and route, and label any company-initiated departure as precautionary.",
    ],
    ongoing: [
      'Contact guests due to arrive with road-closure, smoke and rebooking information before they travel.',
    ],
  },
  liaison: {
    immediate: [
      "Reach the fire's incident management team or agency dispatch to register the property, its occupancy and its evacuation needs.",
    ],
    ongoing: [
      'Attend agency cooperator briefings and bring back spread projections, planned burn operations, road closures and re-entry criteria.',
    ],
  },
  ops: {
    immediate: [
      'Stage buses/vans and drivers for guests without vehicles; set departure order: mobility-impaired, employee housing, then remaining guests.',
    ],
    ongoing: [
      'During evacuation, sweep every room and housing unit, mark each as cleared, and report the final count to Planning.',
    ],
  },
  planning: {
    immediate: [
      'Map primary and alternate evacuation routes and flag any threatened by the fire perimeter, smoke visibility or closures.',
    ],
  },
  logistics: {
    immediate: [
      'Reserve relocation lodging and a reception site outside the threat area; keep fleet vehicles fueled above half a tank.',
    ],
    ongoing: [
      'Set HVAC to recirculate, fit MERV-13 or better filters, and designate a clean-air room for guests and staff.',
    ],
  },
  finance: {
    ongoing: [
      'Log the start and end time of each evacuation order and road closure affecting the property; civil-authority business-interruption claims rely on them.',
    ],
  },
});

const WILDFIRE_INTAKE = [
  intakeGroup('t-wildfire', 'Fire & Evacuation Status', [
    "What is the fire's name (if known), its distance and direction from the property, and which way is it moving?",
    'Is an evacuation order or warning (Ready / Set / Go) in effect for the property or its access roads? Issued by which agency?',
    'Are flames, embers or heavy smoke visible from the property? What are the current wind speed and direction?',
    'Which evacuation routes out of the property are open, closed, or threatened by fire or smoke?',
  ]),
  intakeGroup('t-wildfire-occupancy', 'Occupancy & Evacuation Needs', [
    'How many people on site (guests, staff, employee-housing residents) have no vehicle of their own to evacuate in?',
    'Does anyone with a respiratory condition need to leave early because of smoke, before any evacuation order?',
    'Is power, water, phone or internet service affected, including any planned utility safety shutoff?',
  ]),
];

// ── Hurricane / Tropical ─────────────────────────────────────────────────────

const HURRICANE = checklistItems('t-hurricane', {
  ic: {
    immediate: [
      'Set go/no-go decision points for closing, evacuating and securing the property, timed back from arrival of tropical-storm-force winds.',
      "Order guest departure no later than the county's evacuation order for the property's zone, leaving time to clear before winds arrive.",
    ],
    ongoing: [
      'Name the ride-out team (if staying is permitted) and release all other staff in time to secure their own homes and families.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Turn on the Hurricanes layer and log a summary of every NHC advisory (category, track, cone, landfall time) within 30 minutes of issue.',
      'List every property, office, ship and tour group in or near the forecast cone and brief the IC on who is exposed and when.',
    ],
    ongoing: [
      'Track NWS hurricane, tropical-storm, storm-surge and flood warnings for each exposed location, plus inland river gauges.',
      'Use Ships (AIS) to confirm each vessel in the region is on its planned diversion course and report its distance from the storm.',
      'After landfall, monitor Power Outages and OSINT/news for utility, road, bridge, airport and port status around each property.',
    ],
    demob: [
      'Stand down storm monitoring for each location only after its warnings are cancelled and nearby river gauges have crested and are falling.',
    ],
  },
  safety: {
    immediate: [
      'Close beaches, pools, marinas and water sports once a tropical-storm watch is issued, before surf and rip currents build.',
    ],
    ongoing: [
      'Stop all outdoor work at sustained 40 mph winds and keep staff inside through the eye until the back side of the storm has passed.',
    ],
    demob: [
      'Before re-entry, check for downed lines, gas leaks, standing water and structural damage; never run generators indoors.',
    ],
  },
  pio: {
    immediate: [
      'Publish the IC-approved cancellation, waiver and rebooking policy for affected arrivals, tours and sailings.',
    ],
  },
  liaison: {
    immediate: [
      "Confirm the property's evacuation zone and the timing of county evacuation orders, bridge/causeway closures and contraflow.",
    ],
    ongoing: [
      'Track Coast Guard port conditions (Whiskey, X-Ray, Yankee, Zulu) for affected ports and coordinate berths with port agents.',
    ],
  },
  ops: {
    immediate: [
      'Install shutters and flood barriers, bring in outdoor furniture, signage and umbrellas, and move vehicles and carts to high ground.',
    ],
    ongoing: [
      'At first safe light after the storm, run a building-by-building damage assessment and send findings with photos to Planning.',
    ],
  },
  planning: {
    immediate: [
      "Turn the IC's decision points into a timed preparation schedule with an owner per task, and update it after each NHC advisory.",
    ],
  },
  logistics: {
    immediate: [
      'Stock at least 72 hours of water, food, fuel, medical supplies and batteries for the ride-out team, and test satellite phones.',
      'Pre-book inland relocation lodging and motorcoaches for guests and staff, and confirm key vendors can still deliver.',
    ],
  },
  finance: {
    immediate: [
      'Photograph and video every building, interior and major equipment before landfall to document pre-storm condition for insurers.',
    ],
    ongoing: [
      'Track preparation, evacuation, refund and repair costs separately so they can be claimed against the named-storm deductible.',
    ],
  },
});

const HURRICANE_INTAKE = [
  intakeGroup('t-hurricane', 'Storm & Exposure', [
    'Which NHC advisory is current, and is the property inside the forecast cone or under a hurricane or tropical-storm watch or warning?',
    'When are tropical-storm-force winds expected at the property, and when is landfall forecast?',
    'Is the property in a designated evacuation zone? Has an evacuation order been issued for that zone?',
    'What storm-surge height is forecast, and are any buildings, roads or causeways below that level?',
  ]),
  intakeGroup('t-hurricane-readiness', 'Readiness & Occupancy', [
    'How many arrivals, tours or sailings are due in the next 72 hours, and how many staff would stay for a ride-out?',
    'Which preparations (shutters, barriers, generator fuel, supplies) are complete and which are outstanding?',
    'Which ships, tour groups or traveling guests are on or near the forecast track?',
  ]),
];

// ── Severe Weather ───────────────────────────────────────────────────────────

const SEVERE_WEATHER = checklistItems('t-severe-weather', {
  ic: {
    immediate: [
      'Confirm who orders outdoor activities stopped and guests into shelter for each hazard: tornado, severe thunderstorm, lightning, extreme heat.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Turn on NWS Alerts, Precipitation Radar and Lightning at the property; log the warning type, expiry time and storm motion.',
      'Call the property the moment a tornado or severe thunderstorm warning polygon covers it and confirm they received the warning.',
    ],
    ongoing: [
      'Alert the property when Lightning shows strikes within 6 miles, and report when 30 minutes have passed with none.',
      'Watch the Wind layer and storm reports for gusts over 58 mph or large hail heading for the property and warn Operations ahead of the core.',
      'After the storm passes, check Power Outages and OSINT/news for utility, road and cell-network impacts around the property.',
    ],
    demob: [
      'Confirm all warnings have expired and no further cells are upstream on Radar before advising the all-clear.',
    ],
  },
  safety: {
    immediate: [
      'Move people to designated storm shelters: interior, lowest-floor rooms away from windows — not atriums, large-span halls or vehicles.',
    ],
    ongoing: [
      'Enforce the 30/30 rule: clear pools, trails, golf courses and viewpoints at lightning within 6 miles; resume 30 minutes after the last strike.',
      'For extreme heat, move outdoor work to cooler hours, enforce water-rest-shade breaks and warn hikers about heat illness.',
    ],
    demob: [
      'Inspect for downed trees, hanging limbs, downed power lines and hail or roof damage before reopening grounds, trails and parking.',
    ],
  },
  pio: {
    immediate: [
      'Push the warning to in-house guests (room phones, SMS, PA) with plain instructions on where to shelter and when the next update comes.',
    ],
  },
  liaison: {
    ongoing: [
      'Coordinate with park or county dispatch on overdue hikers, trail parties or vehicles caught out in the storm.',
    ],
  },
  ops: {
    immediate: [
      'Recall tours, hikes, trail rides, boats and bike groups in the warned area to the nearest substantial building or hard-topped vehicle.',
      'Bring in or tie down patio furniture, umbrellas, tents, signage and loose items that could become projectiles.',
    ],
    ongoing: [
      'Account for every tour group, trail party and outdoor worker after the storm and report anyone overdue to the IC.',
    ],
  },
  planning: {
    ongoing: [
      'Collect damage reports and photos by building and area, and rank reopening priorities for the IC.',
    ],
  },
  logistics: {
    immediate: [
      'Check standby generators and fuel, and stage flashlights, radios and first-aid kits in each shelter area.',
    ],
  },
  finance: {
    demob: [
      'Get contractor estimates for hail, wind and water damage and confirm with the broker whether a wind/hail deductible applies before repairs begin.',
    ],
  },
});

const SEVERE_WEATHER_INTAKE = [
  intakeGroup('t-severe-weather', 'Storm Hazard & Shelter', [
    'What is occurring or warned: tornado, damaging wind, large hail, lightning, flash flooding, dust storm or extreme heat?',
    'Which NWS warning covers the property, and when does it expire?',
    'Have guests and staff moved to shelter? Are any tour groups, hikers or workers still outside?',
    'Has anyone been struck by lightning, hit by debris or suffered heat illness?',
    'Is there damage to buildings, vehicles or trees, or any downed power lines?',
    'Is power, water or communications service affected?',
  ]),
];

// ── Winter Storm ─────────────────────────────────────────────────────────────

const WINTER_STORM = checklistItems('t-winter-storm', {
  ic: {
    immediate: [
      'Decide before the storm whether to hold guests over, move departures earlier or cancel arrivals, based on forecast road closures.',
    ],
    ongoing: [
      'Keep enough staff lodged on property to run snow removal, heat and guest services if roads close for days.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Log NWS winter storm, blizzard and ice storm warnings for the property and travel corridors, with timing of the heaviest snow, ice and wind.',
      'Track state DOT closures, chain laws and pass conditions for access routes and motorcoach itineraries; alert Operations to each change.',
    ],
    ongoing: [
      'Watch Power Outages at the property and confirm with Logistics that generators and heat are running when utility power drops.',
      'Check Flights (ADS-B) and airport status for ground stops at gateway airports, and list the guests and staff affected.',
    ],
    demob: [
      'Confirm roads to the property are open without restrictions before advising departures and arrivals can resume.',
    ],
  },
  safety: {
    immediate: [
      'Set cold-exposure limits for outdoor staff by wind chill: warm-up breaks, insulated PPE and a buddy system.',
    ],
    ongoing: [
      'Keep vehicle, generator, furnace and dryer exhausts clear of drifting snow to prevent carbon monoxide build-up.',
      'Monitor roof snow loads and ice dams; clear roofs only with fall protection and keep people away from eaves where snow slides.',
    ],
  },
  pio: {
    immediate: [
      'Tell arriving guests about closures, chain requirements and winter-driving risks, and offer to rebook rather than have them drive in.',
    ],
  },
  liaison: {
    ongoing: [
      'Coordinate with state DOT, park road crews and county dispatch on plowing priority, closure times and help for stranded guests.',
    ],
  },
  ops: {
    immediate: [
      'Pre-position plows, crews, sand and salt; clear emergency access, fire lanes, hydrants, entrances and walkways first.',
      'Protect exposed water lines with heat trace or drain them, and keep heat on in unoccupied buildings to prevent frozen pipes.',
    ],
    ongoing: [
      'Stop or reroute snowcoach, motorcoach and outdoor tours when roads close or visibility drops, and confirm every party arrives safely.',
    ],
  },
  planning: {
    ongoing: [
      'Keep a list of guests, staff and tour groups stranded on property or en route, with location and needs, until each is resolved.',
    ],
  },
  logistics: {
    immediate: [
      'Top off generator, vehicle and heating fuel, and stock food, water, blankets and cots to shelter stranded people for 72 hours.',
    ],
    ongoing: [
      'Arrange lodging, meals and 4x4 or chained transport for employees who cannot get home or to work.',
    ],
  },
  finance: {
    ongoing: [
      'Track snow-removal overtime, holdover staff costs and comped rooms and meals for stranded guests under the incident cost code.',
    ],
  },
});

const WINTER_STORM_INTAKE = [
  intakeGroup('t-winter-storm', 'Conditions & Access', [
    'What are current snow or ice accumulation, visibility, temperature and wind chill at the property?',
    'Are access roads, passes or the park entrance open, restricted (chains / 4x4) or closed? Is a reopening time known?',
    'Are any guests, staff, motorcoaches or tour groups stranded on property or en route? Where?',
  ]),
  intakeGroup('t-winter-storm-facility', 'Facility & Staffing', [
    'Are power, heat and water working? If on generator, how many hours of fuel remain?',
    'Are there roof snow-load, ice-dam, or frozen or burst pipe problems?',
    'How many staff are on site, and can relief staff reach the property?',
  ]),
];

// ── Flood ────────────────────────────────────────────────────────────────────

const FLOOD = checklistItems('t-flood', {
  ic: {
    immediate: [
      'Move guests and staff out of flood-prone buildings, low parking areas, washes and canyon bottoms before water rises, not after.',
      'Decide between moving people to upper floors and leaving the property, based on access-road status and time until flooding.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Alert the property at once to any Flash Flood Warning or Emergency covering it or its upstream drainages, including nearby burn scars.',
      'Open Rivers & Floods for gauges upstream of the property and log current stage, flood stage and forecast crest time.',
    ],
    ongoing: [
      'Watch Radar and the Precipitation Forecast over upstream basins; heavy rain miles away can flood a dry wash at the property.',
      'Report gauge trends (rising, cresting, falling) to the IC hourly, and immediately when a gauge passes action or flood stage.',
      'Monitor OSINT/news and Power Outages for washed-out roads and bridges and utility losses that could isolate the property.',
    ],
    demob: [
      'Keep watching upstream gauges and Radar until the river falls below action stage and no further heavy rain is forecast.',
    ],
  },
  safety: {
    immediate: [
      'Forbid driving or wading through floodwater anywhere, including property roads and parking areas: turn around, don\'t drown.',
    ],
    ongoing: [
      'Have a qualified electrician de-energize flooded areas before anyone enters standing water inside a building.',
    ],
    demob: [
      'Treat floodwater as contaminated: gloves and boots for cleanup, test drinking water, and remove or remediate wet materials for mold.',
    ],
  },
  pio: {
    immediate: [
      'Tell guests which roads and trails are closed and where to shelter, and warn them not to cross flooded roads or watch from riverbanks.',
    ],
  },
  liaison: {
    immediate: [
      'Contact park or county dispatch and emergency management for evacuation orders, road washouts and swiftwater rescue availability.',
    ],
  },
  ops: {
    immediate: [
      'Close trails, campgrounds, washes, slot canyons and riverside areas, and recall guided hikes, rafts and tours in the watershed.',
      'Place sandbags or flood barriers and move vehicles, equipment and inventory out of basements, low floors and low parking lots.',
    ],
  },
  planning: {
    immediate: [
      'Map low points, flood-prone buildings and access roads against the forecast crest to set when each area must be vacated.',
    ],
  },
  logistics: {
    immediate: [
      'Stock bottled water in case the water system is contaminated, and stage pumps, wet vacs and portable generators.',
    ],
    ongoing: [
      'Plan alternate supply and staff access (alternate routes, air support through agencies) if washouts cut the property off.',
    ],
  },
  finance: {
    demob: [
      'Photograph high-water marks, damage and contents before cleanup, and confirm which flood policies apply to each building.',
    ],
  },
});

const FLOOD_INTAKE = [
  intakeGroup('t-flood', 'Flooding & Access', [
    'Is this flash flooding, river flooding, coastal or storm-surge flooding, or a debris flow from a burn scar?',
    'Is anyone trapped by water or requesting rescue? Where?',
    'Where is the water now, is it rising, steady or falling, and has it reached any buildings?',
    'Are guests, staff, vehicles or tour groups in or near flooded areas, washes, canyons or riverbanks?',
    'Which access roads, bridges or trails are flooded, washed out or closed?',
    'Are water, sewer, power or gas systems affected, and is the drinking water safe?',
  ]),
];

// ── Earthquake ───────────────────────────────────────────────────────────────

const EARTHQUAKE = checklistItems('t-earthquake', {
  ic: {
    immediate: [
      'Decide which buildings stay occupied pending inspection; move occupants of damaged buildings to open areas clear of facades and lines.',
      'At a coastal location, order movement to high ground after strong or long shaking or any tsunami warning — do not wait for confirmation.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Open Earthquakes (USGS) and Property Watch; log magnitude, depth, epicenter and distance to each property, office, ship and tour group in range.',
      'Check NWS Alerts for tsunami warnings or advisories affecting coastal properties, ports and ships, and notify the IC immediately.',
    ],
    ongoing: [
      'Log each aftershock of M4.0 or greater and notify Safety, since damaged structures may need re-inspection.',
      'Monitor Power Outages and OSINT/news for road, bridge, utility, cell-network and hospital impacts around the property.',
      'Contact every property, office and traveling guest group within felt range to confirm status and log each reply.',
    ],
    demob: [
      'Keep reporting significant aftershocks until the USGS aftershock forecast shows a low chance of damaging events.',
    ],
  },
  safety: {
    immediate: [
      'Check for gas leaks (odor, hissing); shut the gas main only if a leak is suspected, and keep ignition sources away.',
    ],
    ongoing: [
      'Keep damaged buildings closed until an engineer inspects and tags them (ATC-20 green/yellow/red); re-inspect after strong aftershocks.',
      'Check trails, roads and slopes above buildings for rockfall, landslides and damaged retaining walls before reopening them.',
    ],
  },
  pio: {
    immediate: [
      'Tell guests to expect aftershocks, to Drop, Cover and Hold On if shaking resumes, and where the outdoor assembly areas are.',
    ],
  },
  liaison: {
    immediate: [
      'Coordinate with park or county emergency management on road and bridge inspections, hospital status and access for structural engineers.',
    ],
  },
  ops: {
    immediate: [
      'Sweep each building for trapped or injured people, worst-damaged first, without entering visibly unstable structures.',
      'Check every elevator for trapped occupants and take all elevators out of service until inspected.',
    ],
    ongoing: [
      'Inspect water, sewer, gas, electrical and fire-sprinkler systems for damage before restoring service to each building.',
    ],
  },
  planning: {
    ongoing: [
      'Keep a building status board (open, restricted, closed) with inspection results and the number of guest rooms usable.',
    ],
  },
  logistics: {
    immediate: [
      'Set up outdoor assembly and shelter areas with water, blankets, lighting and first aid for guests who cannot return to rooms.',
    ],
    ongoing: [
      'Switch to satellite phones or radios if cell and landline networks are overloaded, and set fixed check-in times with the GSOC.',
    ],
  },
  finance: {
    ongoing: [
      "Confirm earthquake coverage and deductibles, and document damage with photos and engineers' reports before repairs begin.",
    ],
  },
});

const EARTHQUAKE_INTAKE = [
  intakeGroup('t-earthquake', 'Shaking & Life Safety', [
    'How strong was the shaking and how long did it last? Have aftershocks been felt?',
    'Is anyone trapped in a building, elevator or under debris?',
    'Have guests and staff left damaged buildings? Where are they assembled?',
  ]),
  intakeGroup('t-earthquake-damage', 'Damage & Hazards', [
    'Which buildings show visible damage (cracks, fallen facades or ceilings, broken glass)?',
    'Is there a gas odor, water leak, fire or electrical hazard?',
    'Are roads, bridges and trails to the property passable, or blocked by rockfall or landslides?',
    'Is the location on a coast, and has a tsunami warning or unusual water movement been reported?',
  ]),
];

// ── Wildlife ─────────────────────────────────────────────────────────────────

const WILDLIFE = checklistItems('t-wildlife', {
  ic: {
    immediate: [
      'If an animal has injured someone or is still acting aggressively near people, keep guests indoors and close the affected area now.',
    ],
  },
  'gsoc-support': {
    immediate: [
      'Drop a map pin at the exact encounter location and log species, number, behavior, time and direction of travel.',
      'Notify NPS or state wildlife dispatch of any attack, aggressive animal or food-conditioned bear, and log the agency incident number.',
    ],
    ongoing: [
      'Watch OSINT/news and park alerts for other sightings or trail closures near the property and add them to the incident log.',
      'Alert Operations when the animal is reported moving toward occupied buildings, trails in use or tour routes.',
    ],
    demob: [
      "Log the agency's disposition (hazed, relocated, removed, closure lifted) and time before recommending areas reopen.",
    ],
  },
  safety: {
    immediate: [
      'Keep people at least 100 yards from bears and wolves and 25 yards from bison, elk and other wildlife; never approach for photos.',
    ],
    ongoing: [
      'Refer anyone bitten or scratched, or who slept in a room where a bat was found, to medical care for rabies exposure assessment.',
      'Confirm staff on affected trails carry bear spray and know how to use it, and stop solo hiking and solo outdoor work there.',
    ],
  },
  pio: {
    immediate: [
      "Brief guests on affected areas: stay indoors or in groups, keep distance, store food properly, and don't feed or approach animals.",
    ],
  },
  liaison: {
    immediate: [
      'Coordinate with NPS wildlife/bear management rangers or the state wildlife agency, who decide on hazing, closures, trapping or removal.',
    ],
  },
  ops: {
    immediate: [
      'Close affected trails, paths, picnic areas and parking lots with signs and staff until the agency clears them.',
      'Recall guided hikes, trail rides and bike tours in the area, and escort guests between buildings while the animal is nearby.',
    ],
    ongoing: [
      'Secure food, garbage and grease bins in bear-resistant containers and remove attractants from around buildings and vehicles.',
    ],
  },
  planning: {
    ongoing: [
      'Record each encounter (species, location, time, action taken) to identify repeat animals and hot spots for the agency and the AAR.',
    ],
  },
  logistics: {
    ongoing: [
      'Restock bear spray, air horns and closure signage, and repair damaged bear-resistant bins, doors and window screens.',
    ],
  },
});

const WILDLIFE_INTAKE = [
  intakeGroup('t-wildlife', 'Animal & Encounter', [
    'What species (bear, bison, elk, moose, mountain lion, snake, other) and how many? Are young animals or a carcass nearby?',
    'Where exactly is or was the animal, and which way is it moving now?',
    'What happened: sighting, bluff charge, contact or attack, animal inside a building, or property damage?',
    'Was anyone bitten, scratched or injured, or did anyone have contact with a bat?',
    'Is the animal still present, and is it aggressive, food-conditioned or injured?',
    'Have NPS or state wildlife officials been notified? Is an agency incident number available?',
  ]),
];

// ── Exports ──────────────────────────────────────────────────────────────────

export const NATURAL_TYPE_CHECKLISTS: Record<string, ChecklistBlockItem[]> = {
  wildfire: WILDFIRE,
  hurricane: HURRICANE,
  'severe-weather': SEVERE_WEATHER,
  'winter-storm': WINTER_STORM,
  flood: FLOOD,
  earthquake: EARTHQUAKE,
  wildlife: WILDLIFE,
};

export const NATURAL_TYPE_INTAKE: Record<string, IntakeBlockGroup[]> = {
  wildfire: WILDFIRE_INTAKE,
  hurricane: HURRICANE_INTAKE,
  'severe-weather': SEVERE_WEATHER_INTAKE,
  'winter-storm': WINTER_STORM_INTAKE,
  flood: FLOOD_INTAKE,
  earthquake: EARTHQUAKE_INTAKE,
  wildlife: WILDLIFE_INTAKE,
};
