import { useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from './authStore';
import { GlobeAnimation } from './GlobeAnimation';
import { SpaceLayer } from './SpaceLayer';
import { StatusPanel } from './StatusPanel';

export function AuthGate({ children }: { children: ReactNode }) {
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);

  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Restore session from cookie on mount.
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => setUser(null));
  }, [setUser]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
      </div>
    );
  }

  if (user) return <>{children}</>;

  const switchTab = (t: typeof tab) => {
    setTab(t);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body = tab === 'login'
        ? { email, password }
        : { email, name, password, code: code.trim().toUpperCase() };
      const res = await fetch(`/api/auth/${tab}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json() as { error?: string } & Record<string, unknown>;
      if (!res.ok) { setError(data.error ?? 'Something went wrong'); return; }
      setUser(data as unknown as Parameters<typeof setUser>[0]);
    } catch {
      setError('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-white/10 bg-white/4 px-3 py-2.5 text-[13px] text-white/90 placeholder-white/25 outline-none transition focus:border-accent/40 focus:bg-white/6';

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-ink-950">

      {/* Twinkling starfield (z-0) + arrow-key ship (z-5, desktop) */}
      <SpaceLayer />

      {/* Soft radial depth glow centred behind the globe */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse 55% 50% at 50% 38%, rgba(61,220,255,0.07), rgba(5,7,10,0) 62%)',
        }}
      />

      {/* Centred composition — globe, form, status all on one vertical axis.
          Scroll wrapper has no z-index/transform so the globe (z-1) and card
          (z-20) escape to the root stacking context, letting the ship (z-5)
          fly in front of the globe but tuck behind the card. min-h-full keeps
          it centred without clipping the top when content overflows. */}
      <div className="absolute inset-0 overflow-y-auto">
        <div className="flex min-h-full flex-col items-center justify-center gap-6 px-4 py-10">

          {/* Globe — the focal point, fully visible, dead centre */}
          <div className="pointer-events-none relative z-[1] aspect-square w-[min(82vw,40vh,380px)] shrink-0 opacity-95">
            <GlobeAnimation />
          </div>

          {/* Sign-in card */}
          <div className="relative z-20 w-full max-w-sm space-y-6 rounded-2xl border border-accent/12 bg-ink-950/72 px-6 py-7 shadow-[0_0_0_1px_rgba(61,220,255,0.06),0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl">
            <div className="text-center">
              {/* War Room badge */}
              <div className="mb-3 flex items-center justify-center gap-2">
                <div className="h-px w-8 bg-gradient-to-r from-transparent to-accent/30" />
                <span className="font-mono text-[8px] uppercase tracking-[0.28em] text-accent/55">
                  Virtual War Room
                </span>
                <div className="h-px w-8 bg-gradient-to-l from-transparent to-accent/30" />
              </div>
              <p className="font-mono text-[20px] font-bold tracking-[0.22em] text-white/90 [text-shadow:0_0_24px_rgba(61,220,255,0.25)]">
                GSOC<span className="text-accent">MONITOR</span>
              </p>
              <p className="mt-1 text-[11px] tracking-wide text-white/35">Global Security Operations Center</p>
            </div>

            <div className="flex rounded-lg border border-white/10 bg-ink-950/40 p-1">
              {(['login', 'signup'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => switchTab(t)}
                  className={`flex-1 rounded-md py-1.5 text-[11px] font-semibold uppercase tracking-wider transition ${
                    tab === t ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  {t === 'login' ? 'Sign in' : 'Sign up'}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              {tab === 'signup' && (
                <input type="text" placeholder="Full name" value={name}
                  onChange={(e) => setName(e.target.value)} required className={inputCls} />
              )}
              <input type="email" placeholder="Email" value={email}
                onChange={(e) => setEmail(e.target.value)} required className={inputCls} />
              <input type="password" placeholder="Password" value={password}
                onChange={(e) => setPassword(e.target.value)} required className={inputCls} />
              {tab === 'signup' && (
                <input
                  type="text"
                  placeholder="Signup code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  required
                  className={`${inputCls} font-mono tracking-[0.25em] placeholder:tracking-normal`}
                />
              )}

              {error && <p className="text-[11px] text-red-400/80">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-accent/20 py-2.5 text-[12px] font-semibold text-accent transition hover:bg-accent/30 disabled:opacity-40"
              >
                {submitting ? '…' : tab === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          </div>

          {/* Ops-console status bar — centred under the form */}
          <div className="relative z-20 w-full max-w-xl">
            <StatusPanel />
          </div>
        </div>
      </div>

      {/* Easter-egg controls hint (desktop only — needs a keyboard) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 hidden justify-center md:flex">
        <span className="rounded-full border border-white/8 bg-ink-950/50 px-3 py-1 font-mono text-[10px] tracking-wide text-white/25 backdrop-blur-sm">
          ↑ ← ↓ → &nbsp;fly the ship
        </span>
      </div>
    </div>
  );
}
