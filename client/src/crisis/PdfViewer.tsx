import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport, RenderTask } from 'pdfjs-dist';

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

// The LEGACY build, main bundle and worker: pdf.js 6 calls brand-new built-ins
// (Map/WeakMap.prototype.getOrInsertComputed) that current Safari and
// pre-2026 Chromium don't have, and the modern build doesn't polyfill them —
// every page rendered blank there. The legacy build bundles those polyfills.
async function loadPdfjs() {
  polyfillWithResolvers();
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
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
  const [measureTick, setMeasureTick] = useState(0);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // Lay out every page when the document or zoom changes, but paint a page's
  // canvas only while it is within ~1 scroll-box height of view, and free it
  // (width = height = 0 drops the backing store immediately, not at GC) once it
  // scrolls further away, so canvas memory stays bounded to a few pages.
  useEffect(() => {
    const pdf = pdfRef.current;
    const host = pagesRef.current;
    const root = scrollRef.current;
    if (state.kind !== 'ready' || !pdf || !host || !root) return;
    // Mounted inside a CSS-hidden tab (display:none): clientWidth is 0, so a
    // fit-width layout now would pin every page to the 280 px floor. Defer until
    // the host is actually laid out, then re-run via measureTick.
    if (host.clientWidth === 0 && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (host.clientWidth > 0) { ro.disconnect(); setMeasureTick((t) => t + 1); }
      });
      ro.observe(host);
      return () => ro.disconnect();
    }
    let disposed = false;
    type Slot = { page: PDFPageProxy; vp: PageViewport; canvas: HTMLCanvasElement; task: RenderTask | null; painted: boolean };
    const slots = new Map<Element, Slot>();
    const dpr = Math.min(3, window.devicePixelRatio || 1);

    const release = (s: Slot) => {
      if (s.task) { try { s.task.cancel(); } catch { /* already settled */ } s.task = null; }
      if (!s.painted) return;
      s.painted = false;
      s.canvas.width = 0;
      s.canvas.height = 0;
    };
    const paint = (s: Slot) => {
      if (disposed || s.painted) return;
      const { page, vp, canvas } = s;
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) { canvas.width = 0; canvas.height = 0; return; }
      s.painted = true;
      ctx.scale(dpr, dpr); // resizing resets the transform, so re-apply on every paint
      const task = page.render({ canvasContext: ctx, canvas, viewport: vp });
      s.task = task;
      task.promise.then(
        () => { if (s.task === task) s.task = null; },
        (e: unknown) => {
          if (s.task === task) s.task = null;
          if ((e as { name?: string } | null)?.name !== 'RenderingCancelledException') console.warn('[pdf-viewer] render failed:', e);
        },
      );
    };

    const io = new IntersectionObserver((entries) => {
      // Tab hidden (display:none): keep what is painted so switching back is instant, as today.
      if (root.getClientRects().length === 0) return;
      for (const en of entries) {
        const s = slots.get(en.target);
        if (!s) continue;
        if (en.isIntersecting) paint(s); else release(s);
      }
    }, { root, rootMargin: '100% 0px' });

    host.textContent = '';
    const hostWidth = Math.max(280, host.clientWidth - 2); // measured after clearing, as today
    (async () => {
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        if (disposed) return;
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: (hostWidth / base.width) * zoom });
        const canvas = document.createElement('canvas');
        canvas.width = 0; // placeholder: CSS-sized white box, no backing store until painted
        canvas.height = 0;
        canvas.style.width = `${Math.floor(vp.width)}px`;
        canvas.style.height = `${Math.floor(vp.height)}px`;
        canvas.className = 'mx-auto mb-3 block rounded bg-white shadow-lg';
        host.appendChild(canvas);
        slots.set(canvas, { page, vp, canvas, task: null, painted: false });
        io.observe(canvas); // observe immediately so page 1 paints without waiting for the rest
      }
    })().catch((e) => { if (!disposed) console.warn('[pdf-viewer] render failed:', e); });

    return () => {
      disposed = true;
      io.disconnect();
      for (const s of slots.values()) release(s); // cancels in-flight renders and frees old-zoom canvases now
    };
  }, [state, zoom, measureTick]);

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
      <div ref={scrollRef} className="max-h-[78vh] overflow-auto p-3">
        <div ref={pagesRef} className="min-w-fit" />
      </div>
    </div>
  );
}
