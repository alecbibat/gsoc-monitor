import { useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from './authStore';

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
    <div className="flex h-screen items-center justify-center bg-ink-950">
      <div className="w-full max-w-sm space-y-6 px-6">
        <div className="text-center">
          <p className="font-mono text-[20px] font-bold tracking-[0.22em] text-white/90">
            GSOC<span className="text-accent">MONITOR</span>
          </p>
          <p className="mt-1 text-[11px] text-white/30">Global Security Operations Center</p>
        </div>

        <div className="flex rounded-lg border border-white/10 p-1">
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
  );
}
