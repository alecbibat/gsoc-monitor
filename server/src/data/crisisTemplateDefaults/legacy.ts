// The original built-in "Vessel Grounding / Run Aground" checklist and intake
// questionnaire, which every incident used before templates became
// admin-editable. Their ids are the keys already stored on existing incidents
// (`checklists`, `intake`), so they are kept VERBATIM and split by meaning:
//
//   - generic ICS items/questions stay in the General scope (every incident),
//   - vessel-specific ones move to the Maritime incident type.
//
// An existing incident therefore keeps every checked item and answer that
// still applies to it; anything that no longer does is shown read-only under
// "earlier checklist" rather than disappearing (templates/model.ts).
// Do not edit the text or ids here.

import type { ChecklistBlockItem, ChecklistPhaseId, IntakeBlockGroup, IntakeBlockQuestion } from '../../crisisTemplates/types';
import type { RoleId } from './helpers';

const it = (id: string, roleId: RoleId, phase: ChecklistPhaseId, text: string): ChecklistBlockItem =>
  ({ id, roleId, phase, text });

/** Generic legacy items — part of the General scope. */
export const LEGACY_GENERAL_CHECKLIST: ChecklistBlockItem[] = [
  it('ic-imm-2', 'ic', 'immediate', 'Assume command and announce it; establish the Incident Command Post (ICP) location.'),
  it('ic-imm-5', 'ic', 'immediate', 'Set initial incident priorities: life safety, incident stabilization, environmental/property protection.'),
  it('ic-ong-1', 'ic', 'ongoing', 'Activate and brief Command Staff (Safety, PIO, Liaison) and General Staff as the incident requires.'),
  it('ic-ong-2', 'ic', 'ongoing', 'Establish operational periods and approve the Incident Action Plan (IAP) objectives.'),
  it('ic-ong-4', 'ic', 'ongoing', 'Approve public information releases before they are issued.'),
  it('ic-ong-5', 'ic', 'ongoing', 'Hold regular command briefings; maintain a common operating picture.'),
  it('ic-ong-6', 'ic', 'ongoing', 'Ensure a decision/communications log is maintained throughout.'),
  it('ic-dem-1', 'ic', 'demob', 'Confirm all persons accounted for and life-safety objectives met before scaling down.'),
  it('ic-dem-2', 'ic', 'demob', 'Approve the demobilization plan and transfer of command if relieved (with full briefing).'),
  it('ic-dem-3', 'ic', 'demob', 'Ensure documentation is collected for the after-action review and investigation.'),

  it('safety-imm-3', 'safety', 'immediate', 'Identify and communicate any immediate life-threatening hazards to the IC — you may stop unsafe acts.'),
  it('safety-ong-1', 'safety', 'ongoing', 'Develop the Safety Message / Site Safety Plan (ICS 208) for each operational period.'),
  it('safety-ong-4', 'safety', 'ongoing', "Coordinate with Operations on rescue/evacuation safety and with Liaison on external responders' safety."),
  it('safety-ong-5', 'safety', 'ongoing', 'Investigate near-misses and injuries; recommend corrective actions to the IC.'),
  it('safety-dem-1', 'safety', 'demob', 'Confirm hazards are mitigated before areas are reopened or personnel released.'),
  it('safety-dem-2', 'safety', 'demob', 'Document safety issues, injuries, and lessons learned for the after-action review.'),

  it('pio-imm-1', 'pio', 'immediate', 'Confirm facts with the IC before any release; never speculate on cause or casualties.'),
  it('pio-imm-2', 'pio', 'immediate', 'Draft a holding statement acknowledging the incident and the safety-first response.'),
  it('pio-imm-4', 'pio', 'immediate', 'Identify approved spokesperson(s); ensure no unauthorized statements are made.'),
  it('pio-ong-1', 'pio', 'ongoing', 'Establish a Joint Information Center (JIC) if warranted; coordinate with agency PIOs via Liaison.'),
  it('pio-ong-2', 'pio', 'ongoing', 'Prepare IC-approved press releases and social/website updates on a set cadence.'),
  it('pio-ong-3', 'pio', 'ongoing', 'Monitor media and social channels; correct misinformation promptly.'),
  it('pio-ong-4', 'pio', 'ongoing', "Coordinate messaging to guests' families and next-of-kin inquiries with company support lines."),
  it('pio-ong-5', 'pio', 'ongoing', 'Log all releases, inquiries, and media contacts.'),
  it('pio-dem-1', 'pio', 'demob', 'Issue an incident-resolution statement once approved by the IC.'),
  it('pio-dem-2', 'pio', 'demob', 'Compile a media/communications summary for the after-action review.'),

  it('liaison-imm-2', 'liaison', 'immediate', "Establish contact points and confirm each agency's capabilities and constraints."),
  it('liaison-imm-3', 'liaison', 'immediate', 'Brief arriving agency representatives on the incident status and ICS structure.'),
  it('liaison-ong-1', 'liaison', 'ongoing', 'Serve as the primary contact for all external agency representatives at the ICP.'),
  it('liaison-ong-2', 'liaison', 'ongoing', 'Relay agency resource offers and requirements to the IC and Operations/Logistics.'),
  it('liaison-ong-3', 'liaison', 'ongoing', 'Resolve inter-agency coordination issues and de-conflict overlapping authorities (e.g., NPS/USCG jurisdiction).'),
  it('liaison-ong-4', 'liaison', 'ongoing', 'Keep a roster of agency reps, contacts, and resources committed.'),
  it('liaison-ong-5', 'liaison', 'ongoing', 'Coordinate with the PIO on unified public messaging across agencies.'),
  it('liaison-dem-1', 'liaison', 'demob', 'Coordinate the orderly release of assisting agency resources with the IC and Logistics.'),
  it('liaison-dem-2', 'liaison', 'demob', 'Capture agency feedback and contacts for the after-action review.'),

  it('ops-imm-2', 'ops', 'immediate', 'Direct life-safety operations first: muster verification, injured-party care, evacuation readiness.'),
  it('ops-ong-1', 'ops', 'ongoing', 'Develop and execute the tactical work assignments (ICS 204) to meet IAP objectives.'),
  it('ops-ong-2', 'ops', 'ongoing', 'Organize resources into Branches/Divisions/Groups as the incident scales.'),
  it('ops-ong-5', 'ops', 'ongoing', 'Provide regular status reports and resource needs to the IC and Planning.'),
  it('ops-dem-2', 'ops', 'demob', 'Provide demobilization input to Planning and debrief tactical teams.'),

  it('planning-imm-2', 'planning', 'immediate', 'Start resource tracking: what is on scene, en route, and requested.'),
  it('planning-imm-3', 'planning', 'immediate', 'Establish the incident documentation process and a master event log.'),
  it('planning-ong-1', 'planning', 'ongoing', 'Facilitate the planning cycle and assemble the written IAP for each operational period.'),
  it('planning-ong-3', 'planning', 'ongoing', 'Track status and location of all resources (Resources Unit) and predict future needs.'),
  it('planning-ong-5', 'planning', 'ongoing', 'Ensure all forms and records are collected by the Documentation Unit.'),
  it('planning-dem-1', 'planning', 'demob', 'Develop the written demobilization plan and coordinate approval with the IC.'),
  it('planning-dem-2', 'planning', 'demob', 'Compile the complete incident record for the after-action review and investigation.'),

  it('logistics-imm-1', 'logistics', 'immediate', 'Establish incident communications (ICS 205): radios, channels, satellite/backup links.'),
  it('logistics-ong-1', 'logistics', 'ongoing', 'Order, receive, and track all resources requested by Operations and the IC.'),
  it('logistics-ong-2', 'logistics', 'ongoing', 'Provide medical support coordination (ICS 206) and staging for casualties.'),
  it('logistics-ong-3', 'logistics', 'ongoing', 'Arrange food, water, shelter, and welfare for responders and displaced guests.'),
  it('logistics-ong-4', 'logistics', 'ongoing', 'Maintain communications infrastructure and resolve equipment failures.'),
  it('logistics-dem-1', 'logistics', 'demob', 'Recover, account for, and return/replace equipment and supplies.'),
  it('logistics-dem-2', 'logistics', 'demob', 'Coordinate return transport of released resources and personnel.'),

  it('finance-imm-1', 'finance', 'immediate', 'Establish incident cost-tracking and a financial documentation process from the outset.'),
  it('finance-imm-2', 'finance', 'immediate', 'Begin time-keeping for all responders and hired resources.'),
  it('finance-ong-1', 'finance', 'ongoing', 'Track all incident costs, contracts, and resource expenditures.'),
  it('finance-ong-2', 'finance', 'ongoing', 'Process procurement requests and vendor agreements from Logistics.'),
  it('finance-ong-3', 'finance', 'ongoing', 'Document any injuries and initiate compensation/claims paperwork with HR/Risk.'),
  it('finance-ong-4', 'finance', 'ongoing', 'Coordinate with company legal/insurance and preserve records for potential liability.'),
  it('finance-ong-5', 'finance', 'ongoing', 'Provide cost projections and financial updates to the IC and Planning.'),
  it('finance-dem-1', 'finance', 'demob', 'Finalize time records, contracts, and cost accounting for the incident.'),
  it('finance-dem-2', 'finance', 'demob', 'Compile the financial and claims package for the after-action review and insurers.'),
];

/** Vessel-specific legacy items — part of the Maritime incident type. */
export const LEGACY_MARITIME_CHECKLIST: ChecklistBlockItem[] = [
  it('ic-imm-1', 'ic', 'immediate', 'Confirm the report: vessel name, position, time of grounding, and that life-safety accounting is underway.'),
  it('ic-imm-3', 'ic', 'immediate', 'Confirm the Master has sounded the appropriate alarm and mustered passengers and crew.'),
  it('ic-imm-4', 'ic', 'immediate', 'Verify emergency notifications made: Coast Guard, VTS/port authority, and company DPA.'),
  it('ic-imm-6', 'ic', 'immediate', 'Conduct rapid size-up: casualties, flooding/stability, pollution, and vessel movement.'),
  it('ic-ong-3', 'ic', 'ongoing', 'Approve all resource requests and external assistance (tugs, salvage, SAR, medical).'),

  it('safety-imm-1', 'safety', 'immediate', 'Conduct an initial hazard assessment: flooding, list/heel, structural instability, fuel/oil, confined spaces.'),
  it('safety-imm-2', 'safety', 'immediate', 'Confirm all responders are wearing appropriate PPE and life jackets in work areas.'),
  it('safety-imm-4', 'safety', 'immediate', 'Verify emergency egress routes and muster stations are clear and lit.'),
  it('safety-ong-2', 'safety', 'ongoing', 'Monitor damage-control and dewatering operations for safe practices.'),
  it('safety-ong-3', 'safety', 'ongoing', 'Track responder fatigue, weather/sea conditions, and slip/trip/fall hazards on listing decks.'),

  it('pio-imm-3', 'pio', 'immediate', 'Coordinate on-board guest messaging with the Master (align with the PA scripts).'),

  it('liaison-imm-1', 'liaison', 'immediate', 'Identify assisting and cooperating agencies: Coast Guard, port/VTS, salvage, SAR, local EMS.'),

  it('ops-imm-1', 'ops', 'immediate', 'Obtain a situation brief from the IC and the Master; establish tactical priorities.'),
  it('ops-imm-3', 'ops', 'immediate', 'Launch damage control: assess flooding, set boundaries, close watertight doors, begin dewatering.'),
  it('ops-imm-4', 'ops', 'immediate', 'Account for all passengers and crew via muster teams; report gaps immediately.'),
  it('ops-imm-5', 'ops', 'immediate', 'Assess whether the vessel is stable and secure or requires immediate evacuation.'),
  it('ops-ong-3', 'ops', 'ongoing', 'Coordinate evacuation/transfer of guests to shore or assisting vessels if ordered.'),
  it('ops-ong-4', 'ops', 'ongoing', 'Direct pollution-containment actions in coordination with Safety and environmental resources.'),
  it('ops-ong-6', 'ops', 'ongoing', 'Coordinate salvage/tug operations once resources arrive.'),
  it('ops-dem-1', 'ops', 'demob', 'Confirm the vessel is secured/refloated and all persons are safe before reducing tactical resources.'),

  it('planning-imm-1', 'planning', 'immediate', 'Begin collecting and displaying situation information (position, stability, weather, tide, casualties).'),
  it('planning-ong-2', 'planning', 'ongoing', 'Maintain the common operating picture: situation status, maps, and vessel stability data.'),
  it('planning-ong-4', 'planning', 'ongoing', 'Prepare contingency plans (worsening flooding, weather change, full evacuation).'),

  it('logistics-imm-2', 'logistics', 'immediate', 'Identify immediate resource needs: pumps, life rafts, medical supplies, lighting, PPE.'),
  it('logistics-imm-3', 'logistics', 'immediate', 'Arrange transport for shore-side resources and potential guest reception ashore.'),
  it('logistics-ong-5', 'logistics', 'ongoing', 'Coordinate ground/marine transport and reception facilities ashore.'),

  it('finance-imm-3', 'finance', 'immediate', 'Stand ready to authorize emergency procurement (tugs, salvage, supplies).'),
];

const q = (id: string, text: string): IntakeBlockQuestion => ({ id, text });

/** Generic legacy intake questions, by id — embedded in the General groups. */
export const LEGACY_GENERAL_INTAKE: Record<'iq-6' | 'iq-7' | 'iq-8' | 'iq-11' | 'iq-23', IntakeBlockQuestion> = {
  'iq-6': q('iq-6', 'What is the best callback number, radio channel, or contact method going forward?'),
  'iq-7': q('iq-7', 'Are there any injuries or fatalities? How many, and what severity?'),
  'iq-8': q('iq-8', 'Is anyone missing or unaccounted for?'),
  'iq-11': q('iq-11', 'Are all persons currently accounted for?'),
  'iq-23': q('iq-23', 'What is the general condition and mood of the guests?'),
};

/** Vessel-specific legacy intake groups — part of the Maritime incident type. */
export const LEGACY_MARITIME_INTAKE: IntakeBlockGroup[] = [
  {
    id: 'vessel', label: 'Vessel Identification & Position', questions: [
      q('iq-1', 'What is the name of the vessel, call sign, and IMO/registration number?'),
      q('iq-2', "What is the vessel's exact position (lat/long) or nearest landmark?"),
      q('iq-3', 'What time did the grounding occur (local and UTC)?'),
      q('iq-4', 'How is the vessel oriented — bow, stern, or midships aground? What is the heading?'),
      q('iq-5', 'Who is reporting, and what is their position/role aboard?'),
    ],
  },
  {
    id: 'lifesafety', label: 'Life Safety Aboard', questions: [
      q('iq-9', 'Is medical assistance required on board right now?'),
      q('iq-10', 'Has a full headcount / muster of passengers and crew been initiated?'),
    ],
  },
  {
    id: 'stability', label: 'Vessel Status & Stability', questions: [
      q('iq-12', 'Is the vessel taking on water? Where, and at what rate?'),
      q('iq-13', 'What is the current list / heel angle — is it stable or increasing?'),
      q('iq-14', 'Is the hull breached? Which compartments are affected?'),
      q('iq-15', 'Is the vessel stationary and secure, or still shifting / pounding?'),
      q('iq-16', 'What is the status of propulsion, steering, and electrical power?'),
      q('iq-17', 'What is the water depth around the vessel and the state of the tide?'),
    ],
  },
  {
    id: 'environmental', label: 'Environmental', questions: [
      q('iq-18', 'Is there any fuel, oil, or pollution observed in the water?'),
      q('iq-19', 'What are the current weather, visibility, and sea conditions?'),
      q('iq-20', 'What is the seabed / shoreline type (rock, sand, reef, mud)?'),
      q('iq-21', 'Are there environmentally sensitive or protected areas nearby?'),
    ],
  },
  {
    id: 'passengers', label: 'Passengers & Guests', questions: [
      q('iq-22', 'How many passengers and how many crew are aboard?'),
      q('iq-24', 'Have guests been directed to muster / assembly stations?'),
      q('iq-25', 'Are life jackets being distributed and worn?'),
    ],
  },
  {
    id: 'command', label: 'Command, Communications & Resources', questions: [
      q('iq-26', 'Has the Master declared an emergency, and at what alert level?'),
      q('iq-27', 'Have the Coast Guard / local maritime authorities been notified?'),
      q('iq-28', 'Are other vessels standing by or able to assist?'),
      q('iq-29', 'What external resources have been requested (tugs, salvage, SAR, medical)?'),
      q('iq-30', 'Has the company Designated Person Ashore (DPA) been notified?'),
    ],
  },
];
