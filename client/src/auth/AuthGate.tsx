import { useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from './authStore';
import { GlobeAnimation } from './GlobeAnimation';

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
    <div className="relative flex h-screen flex-col overflow-hidden bg-ink-950 md:items-center md:justify-center">

      {/* Globe
          Mobile  — in-flow block at the top; height is capped so the form stays visible below.
          Desktop — absolute, centred behind everything, same as before. */}
      <div className="pointer-events-none
        relative flex flex-shrink-0 items-center justify-center overflow-hidden
        h-[54vw] max-h-[280px] min-h-[180px]
        md:absolute md:inset-0 md:h-auto md:max-h-none md:min-h-0 md:overflow-visible">
        <div className="aspect-square w-[82vw] max-w-[280px] opacity-95
          md:w-[clamp(340px,78vw,620px)] md:max-w-none">
          <GlobeAnimation />
        </div>
        {/* Mobile only: fade the bottom of the globe band into the page bg */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-ink-950 md:hidden" />
      </div>

      {/* Desktop-only radial vignette (keeps form text crisp over the full-screen globe) */}
      <div
        className="pointer-events-none absolute inset-0 hidden md:block"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(5,7,10,0) 30%, rgba(5,7,10,0.72) 66%, rgba(5,7,10,0.96) 100%)',
        }}
      />

      {/* Form
          Mobile  — flex-1 so it fills what's left below the globe; overflow-y-auto
                    so the keyboard can't push fields off-screen.
          Desktop — flex-none, centred by the parent justify-center / items-center. */}
      <div className="relative z-10 flex w-full flex-1 items-start justify-center overflow-y-auto px-4 pb-8 pt-2 md:flex-none md:overflow-visible md:p-0">
        <div className="w-full max-w-sm space-y-6 rounded-2xl border border-accent/12 bg-ink-950/72 px-6 py-8 shadow-[0_0_0_1px_rgba(61,220,255,0.06),0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl">
          <div className="text-center">
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
    </div>
  );
}
