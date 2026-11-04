import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LAYER_LEGENDS } from './layerLegends';
import { LightningLegendCompact } from './lightning/LightningLegend';
import { NgfsLegendCompact } from './ngfs/NgfsLegend';
import { WarnLegendCompact } from './warn/WarnLegend';
import { FuelLegendCompact } from './fuel/FuelLegend';
import { FireOutlookLegendCompact } from './fireOutlook/FireOutlookLegend';
import { PRECIP_TICKS } from './precip/PrecipLegend';
import { QPF_LEGEND } from './precip/precipStore';
import { LIGHTNING_STAGES } from './lightning/lightningPalette';
import { WEA_CLASSES } from './warn/warnMeta';
import { FUEL_GROUPS } from './fuel/fbfm40';
import { OUTLOOK_LEGEND } from './fireOutlook/fireOutlookMeta';

describe('LAYER_LEGENDS', () => {
  it('keys each layer once', () => {
    const ids = LAYER_LEGENDS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(LAYER_LEGENDS)('$id has a full legend and a compact key that both render', ({ Legend, Compact }) => {
    expect(renderToStaticMarkup(<Legend />).length).toBeGreaterThan(0);
    expect(renderToStaticMarkup(<Compact />).length).toBeGreaterThan(0);
  });
});

describe('compact keys', () => {
  it('label each lightning stage by the age it lasts until, with the exact range as its title', () => {
    const html = renderToStaticMarkup(<LightningLegendCompact />);
    for (const label of ['&lt;2m', '&lt;10m', '&lt;30m', '&lt;1h', '&lt;3h', '&lt;12h', '&lt;24h']) {
      expect(html).toContain(`>${label}<`);
    }
    for (const s of LIGHTNING_STAGES) expect(html).toContain(`title="${s.label.replace('<', '&lt;')}"`);
  });

  it('label NGFS ages the same way, reading the open last class from the bound before it', () => {
    const html = renderToStaticMarkup(<NgfsLegendCompact />);
    for (const label of ['&lt;15m', '&lt;1h', '&lt;3h', '3h+', 'Non-wildland']) expect(html).toContain(`>${label}<`);
  });

  it('name every WEA class, with the full name and note as its title', () => {
    const html = renderToStaticMarkup(<WarnLegendCompact />);
    for (const c of Object.values(WEA_CLASSES)) {
      expect(html).toContain(`>${c.short}<`);
      expect(html).toContain(`${c.label}: ${c.note}`);
    }
  });

  it('label fuel groups by code and fire potential by short name', () => {
    const fuel = renderToStaticMarkup(<FuelLegendCompact />);
    for (const g of FUEL_GROUPS) expect(fuel).toContain(`>${g.short}<`);
    const fire = renderToStaticMarkup(<FireOutlookLegendCompact />);
    for (const l of OUTLOOK_LEGEND) expect(fire).toContain(`>${l.short}<`);
  });
});

describe('precip ticks', () => {
  it('sit under the colour step of the threshold they name', () => {
    const n = QPF_LEGEND.length;
    expect(PRECIP_TICKS.map((t) => t.label)).toEqual(['0.01', '0.5', '1', '2', '5', '20+']);
    for (const t of PRECIP_TICKS) {
      const i = QPF_LEGEND.findIndex((s) => s.inches === parseFloat(t.label));
      expect(i).toBeGreaterThanOrEqual(0);
      expect(t.at).toBeGreaterThanOrEqual(i / n);
      expect(t.at).toBeLessThanOrEqual((i + 1) / n);
    }
  });
});
