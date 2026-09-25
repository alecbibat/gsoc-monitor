import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChecklistBoard } from './ChecklistBoard';
import { IntakeTable } from './IntakeTable';
import { resolveChecklist, resolveIntake, type CrisisTemplatesConfig } from './templates/model';

// Render smoke tests for the store-free boards the editor, the admin preview
// and the public share page all use (no DOM needed: static markup).

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
    ] },
    { ...META, scope: { incidentType: 'wildfire', propertyId: null }, items: [
      { id: 't-1', roleId: 'gsoc-support', phase: 'ongoing', text: 'Watch the fire perimeter layer' },
    ] },
  ],
  intakeBlocks: [
    { ...META, scope: { incidentType: 'wildfire', propertyId: null }, groups: [
      { id: 't-wildfire', label: 'Fire', questions: [{ id: 'tq-1', text: 'How far is the fire front?' }] },
    ] },
  ],
};

describe('ChecklistBoard', () => {
  const tpl = resolveChecklist(config, 'wildfire', null);

  it("opens on the preferred role and tags non-general items with their scope", () => {
    const html = renderToStaticMarkup(
      <ChecklistBoard template={tpl} state={{ 'g-2': { checked: true, at: '2026-08-19T00:00:00.000Z', by: 'Sam' } }} preferredRoleId="gsoc-support" />
    );
    expect(html).toContain('GSOC Support');
    expect(html).toContain('Watch the fire perimeter layer');
    expect(html).not.toContain('Assume command'); // IC's items aren't on screen
    expect(html).toContain('Wildfire'); // origin chip
    expect(html).toContain('1 of 3');   // overall progress
    expect(html).toContain('Sam');
  });

  it('falls back to the first role for an unknown preference', () => {
    const html = renderToStaticMarkup(<ChecklistBoard template={tpl} state={{}} preferredRoleId="finance" />);
    expect(html).toContain('Assume command');
  });

  it('lists retired state in a collapsed read-only section', () => {
    const html = renderToStaticMarkup(
      <ChecklistBoard
        template={tpl}
        state={{}}
        retired={[{ id: 'old-1', text: 'Old item', roleId: 'ic', checked: true, at: '2026-08-19T00:00:00.000Z' }]}
      />
    );
    expect(html).toContain('Earlier checklist items');
    expect(html).toContain('1 item, 1 checked');
    expect(html).not.toContain('Old item'); // collapsed
  });

  it('says so when nothing applies, still showing retired state', () => {
    const html = renderToStaticMarkup(
      <ChecklistBoard
        template={{ ...tpl, roles: [] }}
        state={{}}
        retired={[{ id: 'old-1', text: null, roleId: null, checked: false, at: 'x' }]}
      />
    );
    expect(html).toContain('No checklist items apply');
    expect(html).toContain('Earlier checklist items');
  });
});

describe('IntakeTable', () => {
  const tpl = resolveIntake(config, 'wildfire', null);

  it('renders answered questions with their group scope, then earlier answers', () => {
    const html = renderToStaticMarkup(
      <IntakeTable
        template={tpl}
        answers={{ 'tq-1': '2 miles', 'gone-1': 'kept' }}
        retired={[{ id: 'gone-1', text: null, answer: 'kept' }]}
      />
    );
    expect(html).toContain('How far is the fire front?');
    expect(html).toContain('2 miles');
    expect(html).toContain('Wildfire');
    expect(html).toContain('Other answers');
    expect(html).toContain('Question no longer in the templates');
    expect(html).toContain('kept');
  });

  it('renders nothing without answers', () => {
    expect(renderToStaticMarkup(<IntakeTable template={tpl} answers={{ 'tq-1': '  ' }} retired={[]} />)).toBe('');
  });
});
