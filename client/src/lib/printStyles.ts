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
// - A repeating page header (position:fixed prints on every page in the
//   engines we target): give the root a child with `.print-page-header`
//   (style it `hidden print:flex` on screen).

export function buildPrintCss(root: string): string {
  const R = `.${root}`;
  return `
@media print {
  @page { size: letter portrait; margin: 0.6in; }

  body > *:not(${R}) { display: none !important; }
  ${R} { position: static !important; overflow: visible !important; }
  ${R} .print-hide, ${R} .${root}-no-print { display: none !important; }

  /* Paper-light theme */
  ${R} {
    background: #ffffff !important;
    color: #0f172a !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    padding-top: 52pt; /* clear the repeating page header */
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

  /* Repeating page header */
  ${R} .print-page-header {
    display: flex !important;
    position: fixed;
    top: 0; left: 0; right: 0;
    align-items: baseline;
    gap: 8pt;
    padding-bottom: 4pt;
    border-bottom: 1pt solid #94a3b8 !important;
    background: #ffffff !important;
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
