import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChecklistEditorBody } from './ChecklistEditor';
import { IntakeEditorBody } from './IntakeEditor';
import { RolesEditorBody } from './RolesEditor';
import { ScopePicker } from './ScopePicker';
import { useAdminPageStore } from './adminPageStore';
import type { CrisisTemplatesConfig } from '../crisis/templates/model';

// Render smoke tests for the admin template editors: the first frame an admin
// sees for a loaded config (static markup — interaction is covered by the
// pure draft operations in draftOps.test.ts).

const META = { custom: false, revision: 0, updatedAt: null, updatedBy: null };
const config: CrisisTemplatesConfig = {
  checklistRoles: {
    ...META,
    roles: [
      { id: 'ic', code: 'IC', title: 'Incident Commander', color: '#fbbf24', reportsTo: 'Leadership', directs: 'All' },
      { id: 'gsoc-support', code: 'GSOC', title: 'GSOC Support', color: '#f97316', reportsTo: 'IC', directs: 'Operators' },
      { id: 'finance', code: 'FSC', title: 'Finance Section Chief', color: '#22c55e', reportsTo: 'IC', directs: 'Units' },
    ],
  },
  checklistBlocks: [
    { ...META, scope: { incidentType: null, propertyId: null }, items: [
      { id: 'g-1', roleId: 'ic', phase: 'immediate', text: 'Assume command' },
      { id: 'g-2', roleId: 'gsoc-support', phase: 'ongoing', text: 'Keep the incident log current' },
    ] },
    { ...META, custom: true, revision: 3, updatedAt: '2026-09-01T12:00:00Z', updatedBy: 'Dana',
      scope: { incidentType: 'wildfire', propertyId: null }, items: [
        { id: 't-1', roleId: 'gsoc-support', phase: 'immediate', text: 'Watch the fire perimeter layer' },
      ] },
  ],
  intakeBlocks: [
    { ...META, scope: { incidentType: null, propertyId: null }, groups: [
      { id: 'g-caller', label: 'Caller', questions: [
        { id: 'gq-1', text: 'Who is reporting?' },
        { id: 'gq-2', text: 'Best callback number?' },
      ] },
      { id: 'g-life', label: 'Life safety', questions: [{ id: 'gq-3', text: 'Any injuries?' }] },
    ] },
  ],
};

afterEach(() => useAdminPageStore.setState({ scope: null }));

describe('ChecklistEditorBody', () => {
  it('opens on General with role sections, empty-role shortcuts and the scope list', () => {
    const html = renderToStaticMarkup(<ChecklistEditorBody config={config} />);
    expect(html).toContain('General (all incidents)');
    expect(html).toContain('Built-in default');
    expect(html).toContain('Assume command');
    expect(html).toContain('Keep the incident log current');
    expect(html).toContain('+ Add items for Finance Section Chief');
    expect(html).not.toContain('Watch the fire perimeter layer'); // another scope's item
    // Scope list: both scopes, with their badges.
    expect(html).toMatch(/>custom</);
    expect(html).toMatch(/>default</);
    expect(html).toContain('No unsaved changes');
  });

  it('starts on the admin page scope, and an empty draft for a scope with no block', () => {
    useAdminPageStore.setState({ scope: { incidentType: 'wildfire', propertyId: 'glacier' } });
    const html = renderToStaticMarkup(<ChecklistEditorBody config={config} />);
    expect(html).toContain('This scope has no items yet.');
    expect(html).toContain('New — not saved yet');
    expect(html).toMatch(/>new</); // listed in the scope list, flagged as new
    expect(html).toContain('+ Add items for Incident Commander');
  });

  it('shows provenance for a customized scope', () => {
    useAdminPageStore.setState({ scope: { incidentType: 'wildfire', propertyId: null } });
    const html = renderToStaticMarkup(<ChecklistEditorBody config={config} />);
    expect(html).toContain('Watch the fire perimeter layer');
    expect(html).toContain('Customized by Dana');
    expect(html).toContain('Reset to default'); // custom scopes can be reset
  });
});

describe('IntakeEditorBody', () => {
  it('renders groups and questions numbered within the scope', () => {
    const html = renderToStaticMarkup(<IntakeEditorBody config={config} />);
    expect(html).toContain('value="Caller"');
    expect(html).toContain('value="Life safety"');
    expect(html).toContain('Any injuries?');
    expect(html).toContain('aria-label="Question 3"');
    expect(html).toContain('+ Add group');
  });
});

describe('RolesEditorBody', () => {
  it('lists every role with its usage and blocks deleting a used one', () => {
    const html = renderToStaticMarkup(<RolesEditorBody config={config} />);
    expect(html).toContain('value="GSOC"');
    expect(html).toContain('value="Finance Section Chief"');
    expect(html).toContain('Used by 2 checklist items in 2 scopes');
    expect(html).toContain('No checklist items use this role yet');
    expect(html).toContain('Can’t delete — checklist items use this role');
  });
});

describe('ScopePicker', () => {
  it('shows types grouped by category and keeps an unknown id selectable', () => {
    const html = renderToStaticMarkup(
      <ScopePicker value={{ incidentType: 'retired-type', propertyId: null }} onChange={() => {}} />
    );
    expect(html).toContain('All incident types');
    expect(html).toContain('All properties');
    expect(html).toContain('<optgroup label="Natural Hazards">');
    expect(html).toContain('retired-type (no longer listed)');
  });
});
