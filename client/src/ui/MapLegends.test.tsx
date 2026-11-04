import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapLegendPanel } from './MapLegends';
import { LAYER_LEGENDS } from '../layers/layerLegends';
import { LEGEND_NOTE } from '../layers/lightning/lightningPalette';
import type { LayerId } from '../types';

const legends = LAYER_LEGENDS.filter((l) => (['radar', 'lightning', 'fireOutlook'] as LayerId[]).includes(l.id));
const noop = () => {};

function render(state: { minimized?: boolean; expanded?: Partial<Record<LayerId, boolean>> } = {}) {
  return renderToStaticMarkup(
    <MapLegendPanel
      legends={legends}
      minimized={state.minimized ?? false}
      expanded={state.expanded ?? {}}
      onMinimizedChange={noop}
      onToggleRow={noop}
    />
  );
}

describe('MapLegendPanel', () => {
  it('puts every active layer in one panel, each row showing its compact key', () => {
    const html = render();
    expect(html.match(/<section/g)).toHaveLength(1);
    for (const title of ['Precipitation Radar', 'Lightning', '7-Day Fire Potential']) expect(html).toContain(title);
    expect(html).toContain('>&lt;10m<');
    expect(html).toContain('>Very dry<');
    expect(html).toContain('strike age');
    // Compact rows, not the full legends.
    expect(html).not.toContain(LEGEND_NOTE);
    expect(html).not.toContain('Sig. fire potential — Ignition<');
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(3);
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1); // the panel header
  });

  it('swaps an expanded row for the full legend, leaving the others compact', () => {
    const html = render({ expanded: { lightning: true } });
    expect(html).toContain(LEGEND_NOTE);
    expect(html).toContain('2–10 min');
    expect(html).not.toContain('>&lt;10m<');
    expect(html).not.toContain('strike age'); // the full legend says it itself
    expect(html).toContain('>Very dry<');
  });

  it('minimizes to a pill counting the hidden keys', () => {
    const html = render({ minimized: true });
    expect(html).toContain('Legend');
    expect(html).toContain('>3<');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Show the legend: Precipitation Radar, Lightning, 7-Day Fire Potential');
    expect(html).not.toContain('Moderate');
    expect(html).not.toContain('&lt;10m');
  });
});
