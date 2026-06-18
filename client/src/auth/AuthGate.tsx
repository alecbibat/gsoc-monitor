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
    <div className="relative flex h-screen flex-col overflow-hidden bg-ink-950 md:flex-row">

      {/* Twinkling starfield (z-0) + arrow-key ship (z-5, desktop) */}
      <SpaceLayer />

      {/* Soft radial depth glow behind the globe pane (desktop) */}
      <div
        className="pointer-events-none absolute inset-0 z-0 hidden md:block"
        style={{
          background:
            'radial-gradient(ellipse 60% 80% at 33% 50%, rgba(61,220,255,0.06), rgba(5,7,10,0) 60%)',
        }}
      />

      {/* Globe
          Mobile  — in-flow band at the top; height capped so the form stays visible below.
          Desktop — its own flex pane on the left; sized by viewport height AND width
                    so the WHOLE sphere is always visible and never overlaps the form. */}
      <div className="pointer-events-none
        relative z-[1] flex flex-shrink-0 items-center justify-center overflow-hidden
        h-[54vw] max-h-[280px] min-h-[180px]
        md:h-full md:max-h-none md:min-h-0 md:flex-1 md:overflow-visible">
        <div className="aspect-square w-[82vw] max-w-[280px] opacity-95
          md:w-[min(80vh,48vw,760px)] md:max-w-none">
          <GlobeAnimation />
        </div>
        {/* Mobile only: fade the bottom of the globe band into the page bg */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-ink-950 md:hidden" />
      </div>

      {/* Form
          Mobile  — flex-1 fills what's left below the globe; scrollable so the keyboard
                    can't push fields off-screen.
          Desktop — fixed-width column on the right, vertically centred. */}
      <div className="relative z-10 flex w-full flex-1 items-start justify-center overflow-y-auto px-4 pb-8 pt-2 md:h-full md:w-[460px] md:flex-none md:flex-shrink-0 md:items-center md:overflow-visible md:px-8 md:py-0">
        <div className="w-full max-w-sm space-y-6 rounded-2xl border border-accent/12 bg-ink-950/72 px-6 py-8 shadow-[0_0_0_1px_rgba(61,220,255,0.06),0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl">
          <div className="text-center">
            {/* War Room badge */}
            <div className="mb-3 flex items-center justify-center gap-2">
              <div className="flex-1 border-t border-accent/12" />
              <span className="font-mono text-[8px] uppercase tracking-[0.28em] text-accent/50">
                Virtual War Room
              </span>
              <div className="flex-1 border-t border-accent/12" />
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
      </div>

      {/* Ops-console status panel — bottom-left, over the globe pane */}
      <StatusPanel />

      {/* Easter-egg controls hint (desktop only — needs a keyboard) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 hidden justify-center md:flex">
        <span className="rounded-full border border-white/8 bg-ink-950/50 px-3 py-1 font-mono text-[10px] tracking-wide text-white/25 backdrop-blur-sm">
          ↑ ← ↓ → &nbsp;fly the ship
        </span>
      </div>
    </div>
  );
}
