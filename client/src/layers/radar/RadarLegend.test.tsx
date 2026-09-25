import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RadarLegend, RadarLegendView } from './RadarLegend';
import {
  intensityLabel,
  LEGEND_MAX_DBZ,
  LEGEND_MIN_DBZ,
  legendGradient,
  RADAR_PALETTES,
  RAIN_INTENSITY,
  snowSwatch,
} from './radarPalettes';

// The radar legend follows the palette the layer is painted in, names the
// same intensity bands the hover readout does, and carries RainViewer's
// required attribution (the globe's credit strip is hidden).

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const pct = (dbz: number) => (((dbz - LEGEND_MIN_DBZ) / (LEGEND_MAX_DBZ - LEGEND_MIN_DBZ)) * 100).toFixed(1);

describe('RadarLegend', () => {
  for (const { id } of RADAR_PALETTES) {
    it(`draws the ${id} ramp and snow colour`, () => {
      const html = renderToStaticMarkup(<RadarLegendView palette={id} snow />);
      // React writes the gradient into the style attribute verbatim (bar the
      // spacing it normalises after colons and commas are left alone).
      expect(html).toContain(legendGradient(id).slice(0, 40));
      expect(html).toContain(attr(snowSwatch(id)));
      for (const label of ['Light', 'Moderate', 'Heavy', 'Extreme', 'Snow', 'Echo intensity']) {
        expect(html).toContain(label);
      }
    });
  }

  it('ticks the band breaks the readout labels change at', () => {
    const html = renderToStaticMarkup(<RadarLegendView palette="classic" snow />);
    const ticks = [...html.matchAll(/class="absolute top-0 h-\[3px\] w-px[^"]*" style="left:([\d.]+)%"/g)].map((m) =>
      Number(m[1])
    );
    const breaks = RAIN_INTENSITY.slice(1).map((b) => b.min);
    expect(ticks).toEqual(breaks.map((d) => Number(pct(d))));
    // Each tick is where the hover readout's wording changes.
    for (const d of breaks) expect(intensityLabel(d - 0.5, false)).not.toBe(intensityLabel(d, false));
  });

  it('names each band in the middle of its stretch of the ramp, as the readout words it', () => {
    const html = renderToStaticMarkup(<RadarLegendView palette="classic" snow />);
    // Light 5–20, Moderate 20–35, Heavy 35–55, Extreme 55–70 dBZ.
    for (const [name, lo, hi] of [
      ['Light', LEGEND_MIN_DBZ, 20],
      ['Moderate', 20, 35],
      ['Heavy', 35, 55],
      ['Extreme', 55, LEGEND_MAX_DBZ],
    ] as const) {
      expect(html).toMatch(new RegExp(`style="left:${pct((lo + hi) / 2)}%"[^>]*>${name}</span>`));
      expect(intensityLabel((lo + hi) / 2, false)).toMatch(new RegExp(`^${name}`));
    }
  });

  it('describes the scale for screen readers', () => {
    const html = renderToStaticMarkup(<RadarLegendView palette="classic" snow />);
    expect(html).toContain(
      'role="img" aria-label="Echo intensity scale, 5 to 70 dBZ: ' +
        'Light below 20 dBZ, Moderate 20–35 dBZ, Heavy 35–55 dBZ, Extreme 55 dBZ and above"'
    );
    expect(html).toContain('title="Moderate: 20–35 dBZ"');
  });

  it('drops the snow swatch when snow is painted as rain', () => {
    for (const { id } of RADAR_PALETTES) {
      const html = renderToStaticMarkup(<RadarLegendView palette={id} snow={false} />);
      expect(html).not.toContain('Snow');
      expect(html).not.toContain(attr(snowSwatch(id)));
      expect(html).toContain('Weather data by');
    }
  });

  it('credits RainViewer with a link, as its terms require', () => {
    const html = renderToStaticMarkup(<RadarLegend />);
    expect(html).toContain('Weather data by');
    expect(html).toMatch(/<a href="https:\/\/www\.rainviewer\.com\/" target="_blank" rel="noopener noreferrer"[^>]*>RainViewer<\/a>/);
  });

  it('reads the palette and snow setting from the radar store (default: classic, snow on)', () => {
    expect(renderToStaticMarkup(<RadarLegend />)).toBe(
      renderToStaticMarkup(<RadarLegendView palette="classic" snow />)
    );
  });
});
