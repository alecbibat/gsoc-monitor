import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Full-screen image viewer: scroll wheel or pinch zooms about the pointer,
// drag pans while zoomed, double-click toggles zoom, Escape / backdrop / ✕
// closes. Portalled to <body> so backdrop-filter ancestors can't trap the
// fixed-position overlay.

const MIN_SCALE = 1;
const MAX_SCALE = 12;

interface View { scale: number; tx: number; ty: number }

const RESET: View = { scale: 1, tx: 0, ty: 0 };

export function ImageLightbox({ src, alt, onClose }: {
  src: string;
  alt?: string;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(RESET);
  // Live pointer positions — one entry per touching finger / pressed button.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; midX: number; midY: number } | null>(null);
  // Set on any drag/pinch so the trailing click can't close the viewer.
  const moved = useRef(false);

  // Zoom about a point p (offset from frame centre), keeping the image pixel
  // under p stationary while the scale changes.
  const zoomAt = (v: View, px: number, py: number, factor: number): View => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
    if (scale === 1) return RESET;
    const r = scale / v.scale;
    return { scale, tx: px - (px - v.tx) * r, ty: py - (py - v.ty) * r };
  };

  const frameOffset = (clientX: number, clientY: number) => {
    const rect = frameRef.current!.getBoundingClientRect();
    return { px: clientX - rect.left - rect.width / 2, py: clientY - rect.top - rect.height / 2 };
  };

  // React registers wheel listeners as passive, so stopping the page behind
  // the overlay from scrolling needs a native non-passive listener.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      setView((v) => zoomAt(v, px, py, Math.exp(-e.deltaY * 0.0022)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Capture phase so an underlying modal's own Escape handler (a bubble
  // listener on the same window) never sees this press.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) moved.current = false;
    pinch.current = null;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const pts = pointers.current;
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    // A mouse-up outside the window leaves a stale entry; drop it as soon as
    // the button-less hover move arrives, or it would pan with no button down.
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      pts.delete(e.pointerId);
      return;
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pts.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;
      setView((v) => (v.scale > 1 ? { ...v, tx: v.tx + dx, ty: v.ty + dy } : v));
    } else if (pts.size === 2) {
      moved.current = true;
      const [a, b] = [...pts.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const last = pinch.current;
      pinch.current = { dist, midX, midY };
      if (!last || last.dist === 0) return;
      const { px, py } = frameOffset(midX, midY);
      setView((v) => {
        const z = zoomAt(v, px, py, dist / last.dist);
        // Two-finger drag pans as well as zooms.
        return z.scale === 1 ? z : { ...z, tx: z.tx + midX - last.midX, ty: z.ty + midY - last.midY };
      });
    }
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  return createPortal(
    <div
      ref={frameRef}
      className="fixed inset-0 z-[3300] flex select-none items-center justify-center overflow-hidden bg-black/85 backdrop-blur-sm"
      style={{ touchAction: 'none', cursor: view.scale > 1 ? 'grab' : 'zoom-in' }}
      onClick={(e) => {
        // The viewer lives in the React tree of whatever opened it (portal
        // events bubble through the React tree, not the DOM) — never let a
        // click fall through to an underlying modal's close-on-backdrop.
        e.stopPropagation();
        if (e.target === e.currentTarget && !moved.current) onClose();
      }}
      onDoubleClick={(e) => {
        const { px, py } = frameOffset(e.clientX, e.clientY);
        setView((v) => (v.scale > 1 ? RESET : zoomAt(v, px, py, 2.5)));
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerLeave={onPointerEnd}
    >
      <img
        src={src}
        alt={alt ?? ''}
        draggable={false}
        className="max-h-[92vh] max-w-[94vw] rounded shadow-2xl"
        style={{
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          transition: pointers.current.size > 0 ? undefined : 'transform 120ms ease-out',
        }}
      />
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute right-4 top-4 rounded-full border border-white/20 bg-black/50 px-2.5 py-1 text-[14px] text-white/70 transition hover:text-white"
        aria-label="Close image viewer"
      >
        ✕
      </button>
      <div className="pointer-events-none absolute bottom-3 left-1/2 max-w-[92vw] -translate-x-1/2 truncate rounded-full border border-white/10 bg-black/60 px-3 py-1 text-center">
        {alt && <span className="mr-2 text-[10px] text-white/70">{alt}</span>}
        <span className="text-[9px] text-white/40">
          scroll / pinch to zoom · drag to pan · double-click to reset
          {view.scale > 1 && ` · ${Math.round(view.scale * 100)}%`}
        </span>
      </div>
    </div>,
    document.body
  );
}

// Thumbnail that opens itself in the lightbox when clicked.
export function ZoomableImage({ src, alt, className }: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="Click to enlarge"
        className="block cursor-zoom-in"
      >
        <img src={src} alt={alt} className={className} draggable={false} />
      </button>
      {open && <ImageLightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}
