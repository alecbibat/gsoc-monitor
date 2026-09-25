import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RadarControls } from './RadarControls';
import { legendGradient } from './radarPalettes';

// Sidebar controls under the radar toggle, rendered with the default prefs
// (2 hr loop, 1× speed, Classic palette, 90% opacity).

const html = renderToStaticMarkup(<RadarControls />);

// The <button> whose text includes `label`, with its attributes.
function button(label: string): string {
  const m = html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${label}(?:(?!</button>).)*</button>`));
  if (!m) throw new Error(`no button for ${label}`);
  return m[0];
}

describe('RadarControls', () => {
  it('offers the three loop lengths, the current one pressed', () => {
    for (const w of ['30 min', '1 hr', '2 hr']) expect(html).toContain(`>${w}</button>`);
    expect(button('2 hr')).toContain('aria-pressed="true"');
    expect(button('30 min')).toContain('aria-pressed="false"');
  });

  it('offers the three speeds, the current one pressed', () => {
    for (const s of ['½×', '1×', '2×']) expect(html).toContain(`>${s}</button>`);
    expect(button('1×')).toContain('aria-pressed="true"');
    expect(button('½×')).toContain('aria-pressed="false"');
  });

  it('shows each palette with a swatch of its ramp', () => {
    for (const p of ['Classic', 'Vivid', 'RainViewer']) expect(html).toContain(`>${p}</span>`);
    expect(button('Classic')).toContain('aria-pressed="true"');
    expect(button('Vivid')).toContain(legendGradient('vivid').slice(0, 40));
  });

  it('has an opacity slider over the store range, with its value', () => {
    expect(html).toMatch(/<input type="range" min="0.2" max="1" step="0.05"[^>]*value="0.9"/);
    expect(html).toContain('90%');
  });
});
