import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// ── In-page PDF reader ───────────────────────────────────────────────────────
// Renders a fetched PDF (the incident's IAP) as stacked page canvases with
// zoom controls. pdf.js rather than an <iframe>/<embed>: most share-link
// viewers are on phones, where inline-embedded PDFs render one page or
// nothing. The library (~350 KB) is imported dynamically on first use so it
// never weighs down the share page until the IAP tab is actually opened.

// pdf.js uses Promise.withResolvers (ES2024) — polyfill for the older mobile
// Safari/Chrome a share link can land on. Must run before the dynamic import.
function polyfillWithResolvers(): void {
  const P = Promise as unknown as { withResolvers?: () => unknown };
  if (typeof P.withResolvers === 'function') return;
  P.withResolvers = function withResolvers<T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (r?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

async function loadPdfjs() {
  polyfillWithResolvers();
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'empty'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; name: string | null; pages: number };

const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2, 3];

export function PdfViewer({ url, emptyMessage }: {
  /** Same-origin PDF endpoint (may answer 404 { noIap } when nothing is uploaded). */
  url: string;
  /** Shown for a 404 — e.g. "No IAP has been uploaded for this incident type yet." */
  emptyMessage: string;
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [zoom, setZoom] = useState(1);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const renderSeq = useRef(0);

  // Fetch + parse once per url.
  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      const res = await fetch(url);
      if (cancelled) return;
      if (res.status === 404) { setState({ kind: 'empty', message: emptyMessage }); return; }
      if (!res.ok) { setState({ kind: 'error', message: `The document could not be loaded (${res.status}).` }); return; }
      const name = res.headers.get('X-IAP-Name');
      const bytes = await res.arrayBuffer();
      if (cancelled) return;
      const pdfjs = await loadPdfjs();
      const pdf = await pdfjs.getDocument({ data: bytes }).promise;
      if (cancelled) { pdf.loadingTask.destroy().catch(() => { /* already gone */ }); return; }
      pdfRef.current = pdf;
      setState({ kind: 'ready', name, pages: pdf.numPages });
    })().catch((e) => {
      if (!cancelled) {
        console.warn('[pdf-viewer] load failed:', e);
        setState({ kind: 'error', message: 'The document could not be displayed in this browser — use "Open" below.' });
      }
    });
    return () => {
      cancelled = true;
      pdfRef.current?.loadingTask.destroy().catch(() => { /* already gone */ });
      pdfRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // (Re)render all pages when the document or zoom changes.
  useEffect(() => {
    const pdf = pdfRef.current;
    const host = pagesRef.current;
    if (state.kind !== 'ready' || !pdf || !host) return;
    const seq = ++renderSeq.current;
    (async () => {
      host.textContent = '';
      const hostWidth = Math.max(280, host.clientWidth - 2);
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      for (let n = 1; n <= pdf.numPages; n++) {
        if (renderSeq.current !== seq) return; // superseded by a newer render
        const page = await pdf.getPage(n);
        if (renderSeq.current !== seq) return;
        const base = page.getViewport({ scale: 1 });
        const scale = (hostWidth / base.width) * zoom;
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width * dpr);
        canvas.height = Math.floor(vp.height * dpr);
        canvas.style.width = `${Math.floor(vp.width)}px`;
        canvas.style.height = `${Math.floor(vp.height)}px`;
        canvas.className = 'mx-auto mb-3 block rounded bg-white shadow-lg';
        host.appendChild(canvas);
        const ctx = canvas.getContext('2d')!;
        ctx.scale(dpr, dpr);
        await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
      }
    })().catch((e) => console.warn('[pdf-viewer] render failed:', e));
  }, [state, zoom]);

  const zoomStep = (dir: 1 | -1) => {
    setZoom((z) => {
      const i = ZOOMS.findIndex((v) => Math.abs(v - z) < 0.01);
      const next = i === -1 ? 1 : ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + dir))];
      return next;
    });
  };

  if (state.kind === 'loading') {
    return (
      <div className="grid min-h-[240px] place-items-center rounded-lg border border-white/10 bg-ink-950/60">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
      </div>
    );
  }
  if (state.kind === 'empty' || state.kind === 'error') {
    return (
      <div className="rounded-lg border border-white/10 bg-white/4 px-5 py-8 text-center">
        <p className="text-[13px] text-white/55">{state.message}</p>
        {state.kind === 'error' && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block rounded border border-white/15 px-3 py-1.5 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white/85"
          >
            Open the PDF directly
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-ink-950/70">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/8 bg-ink-900/70 px-3 py-2">
        <span className="min-w-0 truncate text-[12px] font-medium text-white/75">
          {state.name || 'Incident Action Plan'}
        </span>
        <span className="text-[10px] text-white/35">{state.pages} page{state.pages === 1 ? '' : 's'}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => zoomStep(-1)} aria-label="Zoom out"
            className="h-7 w-7 rounded border border-white/12 text-[13px] text-white/60 transition hover:border-white/25 hover:text-white">−</button>
          <button onClick={() => setZoom(1)} title="Fit width"
            className="h-7 rounded border border-white/12 px-2 text-[10px] tabular-nums text-white/50 transition hover:border-white/25 hover:text-white">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => zoomStep(1)} aria-label="Zoom in"
            className="h-7 w-7 rounded border border-white/12 text-[13px] text-white/60 transition hover:border-white/25 hover:text-white">+</button>
          <a href={url} target="_blank" rel="noreferrer"
            className="ml-1 h-7 rounded border border-white/12 px-2.5 text-[10px] leading-7 text-white/55 transition hover:border-white/25 hover:text-white">
            Open ↗
          </a>
        </div>
      </div>
      {/* Horizontal scroll appears only when zoomed past fit-width */}
      <div className="max-h-[78vh] overflow-auto p-3">
        <div ref={pagesRef} className="min-w-fit" />
      </div>
    </div>
  );
}
