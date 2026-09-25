import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useCrisisStore, type Incident } from './crisisStore';
import {
  resolveChecklist, resolveIntake, retiredChecklistEntries, retiredIntakeEntries, type CrisisTemplatesConfig,
} from './templates/model';
import type { ChecklistStateMap } from './checklistTemplate';
import type { IntakeAnswers } from './intakeTemplate';
import { ChecklistRecord, CorrectiveActions, IntakeRecord, RosterTable } from './AarSections';

// Static rendering reads zustand's server snapshot (the store's INITIAL
// state), so the templates hooks are stood in for by the same resolution over
// a config the tests control.
const tplState = vi.hoisted(() => ({ config: null as unknown, status: 'ready' as 'ready' | 'loading' | 'error' }));
vi.mock('./templates/templatesStore', () => {
  const cfg = () => tplState.config as CrisisTemplatesConfig | null;
  const common = () => ({ status: tplState.status, error: null, reload: () => Promise.resolve() });
  return {
    useCrisisTemplates: () => cfg(),
    useResolvedChecklist: (type: string | null, property: string | null) => {
      const c = cfg();
      const template = c ? resolveChecklist(c, type, property) : null;
      return { ...common(), template, retiredFor: (s: ChecklistStateMap) => (c && template ? retiredChecklistEntries(c, template, s) : []) };
    },
    useResolvedIntake: (type: string | null, property: string | null) => {
      const c = cfg();
      const template = c ? resolveIntake(c, type, property) : null;
      return { ...common(), template, retiredFor: (a: IntakeAnswers) => (c && template ? retiredIntakeEntries(c, template, a) : []) };
    },
  };
});

// Render smoke tests for the after-action report's read-only record sections
// (static markup; no DOM needed — effects such as the templates load don't run).

const META = { custom: false, revision: 0, updatedAt: null, updatedBy: null };
const config: CrisisTemplatesConfig = {
  checklistRoles: {
    ...META,
    roles: [
      { id: 'ic', code: 'IC', title: 'Incident Commander', color: '#fbbf24', reportsTo: 'Leadership', directs: 'All' },
      { id: 'gsoc-support', code: 'GSOC', title: 'GSOC Support', color: '#f97316', reportsTo: 'IC', directs: 'Operators' },
    ],
  },
  checklistBlocks: [
    { ...META, scope: { incidentType: null, propertyId: null }, items: [
      { id: 'g-1', roleId: 'ic', phase: 'immediate', text: 'Assume command' },
      { id: 'g-2', roleId: 'gsoc-support', phase: 'immediate', text: 'Open the incident log' },
      { id: 'g-3', roleId: 'gsoc-support', phase: 'ongoing', text: 'Brief the next shift' },
    ] },
    { ...META, scope: { incidentType: 'flood', propertyId: null }, items: [
      { id: 'f-1', roleId: 'ic', phase: 'immediate', text: 'Check the river gauges' },
    ] },
  ],
  intakeBlocks: [
    { ...META, scope: { incidentType: null, propertyId: null }, groups: [
      { id: 'g-caller', label: 'Caller', questions: [
        { id: 'q-1', text: 'Who is calling?' },
        { id: 'q-2', text: 'Any injuries?' },
      ] },
    ] },
    { ...META, scope: { incidentType: 'flood', propertyId: null }, groups: [
      { id: 't-flood', label: 'Flood', questions: [{ id: 'q-f', text: 'How high is the water?' }] },
    ] },
  ],
};

const AT = '2026-08-19T15:00:00.000Z';

function incident(over: Partial<Incident>): Incident {
  useCrisisStore.setState({ incidents: [], activeIncidentId: null });
  const id = useCrisisStore.getState().createIncident('wildfire');
  return { ...useCrisisStore.getState().incidents.find((i) => i.id === id)!, ...over };
}

beforeEach(() => {
  tplState.config = config;
  tplState.status = 'ready';
});

describe('ChecklistRecord', () => {
  it('lists each role with done/total, who checked what and when, and what was left', () => {
    const html = renderToStaticMarkup(<ChecklistRecord incident={incident({
      checklists: {
        'g-2': { checked: true, at: AT, by: 'Sam Ops' },
        'g-3': { checked: false, at: AT, by: 'Lee' },          // checked, then cleared
        'f-1': { checked: true, at: AT, by: 'Kim' },           // flood item on a wildfire incident
      },
    })} />);
    expect(html).toContain('ICS Checklist Record');
    expect(html).toContain('1 of 3 items done');
    expect(html).toContain('0/1 done');                  // IC
    expect(html).toContain('1/2 done');                  // GSOC
    expect(html).toContain('Open the incident log');
    expect(html).toContain('Sam Ops');
    expect(html).toContain('Not checked (1)');
    expect(html).toContain('Brief the next shift');
    expect(html).toMatch(/unchecked [^<]* by Lee/);
    // State outside the current template stays on the record.
    expect(html).toContain('Earlier checklist items');
    expect(html).toContain('Check the river gauges');
    expect(html).toContain('Incident Commander');
    expect(html).toContain('Kim');
  });

  it('says so when nothing was checked, instead of printing the whole template as undone', () => {
    const html = renderToStaticMarkup(<ChecklistRecord incident={incident({ checklists: {} })} />);
    expect(html).toContain('No checklist items were checked');
    expect(html).not.toContain('Assume command');
  });

  it('shows a loading line (not nothing) while the templates are unavailable', () => {
    tplState.config = null;
    tplState.status = 'loading';
    const html = renderToStaticMarkup(<ChecklistRecord incident={incident({ checklists: { 'g-2': { checked: true, at: AT } } })} />);
    expect(html).toContain('Loading the checklist templates');
  });
});

describe('IntakeRecord', () => {
  it('renders the answered questions only, plus answers to questions no longer resolved', () => {
    const html = renderToStaticMarkup(<IntakeRecord incident={incident({ intake: { 'q-1': 'Front desk', 'q-f': 'Knee deep' } })} />);
    expect(html).toContain('Intake — Initial Contact');
    expect(html).toContain('1 of 2 questions answered');
    expect(html).toContain('Who is calling?');
    expect(html).toContain('Front desk');
    expect(html).not.toContain('Any injuries?');
    expect(html).toContain('How high is the water?');   // retired: flood question
    expect(html).toContain('Knee deep');
  });

  it('says so when no answer was recorded', () => {
    const html = renderToStaticMarkup(<IntakeRecord incident={incident({ intake: { 'q-1': '   ' } })} />);
    expect(html).toContain('No intake answers were recorded.');
  });
});

describe('RosterTable', () => {
  it('keeps holders of a since-removed role, marked as such', () => {
    const inc = incident({
      assignments: [{ id: 'a1', roleId: 'custom-gone', name: 'Kim Diaz', startedAt: AT, endedAt: AT }],
    });
    inc.actionLog = [
      { id: 'l', timestamp: AT, description: '', entryType: 'event', system: 'assignment', meta: { roleId: 'custom-gone', roleTitle: 'Staging Manager' } },
      ...inc.actionLog,
    ];
    const html = renderToStaticMarkup(<RosterTable incident={inc} />);
    expect(html).toContain('Kim Diaz');
    expect(html).toContain('Staging Manager');
    expect(html).toContain('(removed role)');
  });
});

describe('CorrectiveActions', () => {
  it('counts only written, open actions and flags overdue ones', () => {
    const html = renderToStaticMarkup(<CorrectiveActions incident={incident({
      personnel: [{ id: 'p1', name: 'Sam Ops' }],
      aar: {
        correctiveActions: [
          { id: 'c1', text: 'Pre-stage radios', due: '2000-01-01' },
          { id: 'c2', text: 'Update the call tree', due: '2999-01-01' },
          { id: 'c3', text: 'Done already', done: true, due: '2000-01-01' },
          { id: 'c4', text: '' },
        ],
      },
    })} />);
    expect(html).toContain('(2 open');
    expect(html).toContain('1 overdue');
    expect(html.match(/>Overdue</g)).toHaveLength(1);
    expect(html).toContain('<option value="Sam Ops">');
    expect(html).toContain('aria-label="Remove: Pre-stage radios"');
  });
});
