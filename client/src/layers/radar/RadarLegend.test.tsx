import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RadarLegend, RadarLegendView } from './RadarLegend';
import { legendGradient, RADAR_PALETTES, snowSwatch } from './radarPalettes';

// The radar legend follows the palette the layer is painted in, and carries
// RainViewer's required attribution (the globe's credit strip is hidden).

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

describe('RadarLegend', () => {
  for (const { id } of RADAR_PALETTES) {
    it(`draws the ${id} ramp and snow colour`, () => {
      const html = renderToStaticMarkup(<RadarLegendView palette={id} />);
      // React writes the gradient into the style attribute verbatim (bar the
      // spacing it normalises after colons and commas are left alone).
      expect(html).toContain(legendGradient(id).slice(0, 40));
      expect(html).toContain(attr(snowSwatch(id)));
      for (const label of ['Light', 'Moderate', 'Heavy', 'Extreme', 'Snow', 'Echo intensity']) {
        expect(html).toContain(label);
      }
    });
  }

  it('places the intensity marks along the dBZ range', () => {
    const html = renderToStaticMarkup(<RadarLegendView palette="classic" />);
    // 12 / 30 / 45 / 60 dBZ over 5–70 dBZ.
    for (const left of ['10.8%', '38.5%', '61.5%', '84.6%']) expect(html).toContain(`left:${left}`);
  });

  it('credits RainViewer with a link, as its terms require', () => {
    const html = renderToStaticMarkup(<RadarLegend />);
    expect(html).toContain('Weather data by');
    expect(html).toMatch(/<a href="https:\/\/www\.rainviewer\.com\/" target="_blank" rel="noopener noreferrer"[^>]*>RainViewer<\/a>/);
  });

  it('reads the palette from the radar store (default: classic)', () => {
    expect(renderToStaticMarkup(<RadarLegend />)).toBe(renderToStaticMarkup(<RadarLegendView palette="classic" />));
  });
});
