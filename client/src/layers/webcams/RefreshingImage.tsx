import { useEffect, useState } from 'react';

// DOT cameras serve a single JPEG URL that always returns the latest frame, so
// "live" just means re-requesting it on an interval. A cache-busting param forces
// the browser to refetch; onError falls back to a placeholder.
export function RefreshingImage({
  url,
  alt,
  className,
  intervalMs = 30_000,
}: {
  url: string | null;
  alt: string;
  className?: string;
  intervalMs?: number;
}) {
  const [bust, setBust] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!url) return;
    const id = setInterval(() => setBust(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [url, intervalMs]);

  if (!url || failed) {
    return (
      <div className={`flex items-center justify-center text-[11px] text-white/40 ${className ?? ''}`}>
        Live view unavailable
      </div>
    );
  }

  const src = `${url}${url.includes('?') ? '&' : '?'}_r=${bust}`;
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}
