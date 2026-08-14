import { useEffect } from 'react';

// ── Shared print stylesheet for report views ─────────────────────────────────
// (roadmap Track 7, browser-print path). One place fixes printing for every
// report product: the incident archive report and the property risk report
// share this. If/when a server-side Chromium render pipeline lands, it reuses
// the same classes.
//
// What it does, per root class:
// - Hides the rest of the app and any `.print-hide` elements.
// - Flips the on-screen ops-dark theme to a paper-light theme: white page,
//   dark text, light borders. Blanket rules would also grey out the colors
//   that carry meaning (status dots, severity badges), so two escape hatches
//   survive the flip: inline `style="background/color"` values, and the
//   `.print-color` marker class.
// - Page-break discipline: cards/sections/rows don't split, headings never
//   orphan at a page bottom, table headers repeat.
// - A repeating page header via table semantics: wrap the report body as
//   .print-page-table > .print-page-thead (holding a .print-page-header div)
//   + .print-page-tbody. On screen every part carries `block` classes so it
//   lays out as plain divs; in print the table display is restored and the
//   thead both repeats on every page AND reserves its own space — unlike
//   position:fixed, which overprints the top of every page after the first.

export function buildPrintCss(root: string): string {
  const R = `.${root}`;
  return `
@media print {
  @page { size: letter portrait; margin: 0.6in; }

  body > *:not(${R}) { display: none !important; }
  ${R} { position: static !important; overflow: visible !important; }
  ${R} .print-hide, ${R} .${root}-no-print { display: none !important; }
  /* Print-only content: mark the element with BOTH the \`hidden\` attribute
     (screen) and .print-only — used where the screen shows an editor and the
     paper shows clean text (AAR questions, corrective-action table). */
  ${R} .print-only { display: block !important; }

  /* Paper-light theme */
  ${R} {
    background: #ffffff !important;
    color: #0f172a !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  ${R} *:not([style*="background"]):not(.print-color):not(img) { background: transparent !important; }
  ${R} *:not([style*="color"]):not(.print-color) { color: #0f172a !important; }
  ${R} *:not(.print-color) { border-color: #d3dae3 !important; box-shadow: none !important; }
  ${R} .print-color, ${R} .print-color * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  /* De-emphasized ink for elements that are muted on screen */
  ${R} .print-muted, ${R} .print-muted *:not(.print-color) { color: #64748b !important; }

  /* Page-break discipline */
  ${R} section, ${R} .print-card { break-inside: avoid; }
  ${R} h1, ${R} h2, ${R} h3 { break-after: avoid; }
  ${R} thead { display: table-header-group; }
  ${R} tr, ${R} li { break-inside: avoid; }
  ${R} img { max-width: 100% !important; }
  ${R} .print-break-before { break-before: page; }

  /* Repeating page header (table-header-group repeats per page AND reserves
     its space, which position:fixed does not) */
  ${R} .print-page-table { display: table !important; width: 100%; border-collapse: collapse; }
  ${R} .print-page-thead { display: table-header-group !important; }
  ${R} .print-page-tbody { display: table-row-group !important; }
  ${R} .print-page-thead > tr, ${R} .print-page-tbody > tr { display: table-row !important; }
  ${R} .print-page-thead > tr > td, ${R} .print-page-tbody > tr > td { display: table-cell !important; padding: 0; }
  ${R} .print-page-header {
    display: flex !important;
    align-items: baseline;
    gap: 8pt;
    padding: 0 0 4pt;
    margin-bottom: 8pt;
    border-bottom: 1pt solid #94a3b8 !important;
    font-size: 8pt;
  }
}
`;
}

/** Inject the shared print stylesheet for a report root class while mounted. */
export function usePrintStyles(root: string) {
  useEffect(() => {
    const style = document.createElement('style');
    style.id = `print-css-${root}`;
    style.textContent = buildPrintCss(root);
    document.head.appendChild(style);
    return () => style.remove();
  }, [root]);
}
