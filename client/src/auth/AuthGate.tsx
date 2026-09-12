import { useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from './authStore';
import {
  consumeSsoError, fetchAuthConfig, login, signup, startSso,
  FALLBACK_AUTH_CONFIG, type AuthConfig,
} from './authApi';
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
  const [authConfig, setAuthConfig] = useState<AuthConfig>(FALLBACK_AUTH_CONFIG);
  const [showPassword, setShowPassword] = useState(false);
  // A failed SSO round trip comes back as ?sso_error=<code>; read it once on
  // mount so the reason is visible instead of a silently unchanged login page.
  const [ssoError, setSsoError] = useState<string | null>(() => consumeSsoError());

  // Restore session from cookie on mount.
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => setUser(null));
  }, [setUser]);

  useEffect(() => { void fetchAuthConfig().then(setAuthConfig); }, []);

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
    setSsoError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSsoError(null);
    try {
      const signedIn = tab === 'login'
        ? await login(email, password)
        : await signup(email, name, password, code);
      setUser(signedIn);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  };

  const ssoEnabled = authConfig.sso.enabled;
  // Once the rollout reaches admin-only passwords, the form stops being the
  // primary way in — it's the break-glass path — so it collapses behind a
  // disclosure and SSO becomes the obvious action.
  const passwordIsSecondary = ssoEnabled && authConfig.passwordLoginAdminOnly;
  const showPasswordForm = authConfig.passwordLogin && (!passwordIsSecondary || showPassword);

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

            {ssoError && (
              <p className="rounded-lg border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-[11px] leading-relaxed text-amber-200/85">
                {ssoError}
              </p>
            )}

            {ssoEnabled && (
              <button
                onClick={() => startSso()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-accent/30 bg-accent/15 py-2.5 text-[12px] font-semibold text-accent transition hover:border-accent/50 hover:bg-accent/25"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3a9 9 0 100 18 9 9 0 000-18zM3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 010 18M12 3a15 15 0 000 18" />
                </svg>
                {authConfig.sso.label ?? 'Sign in with SSO'}
              </button>
            )}

            {ssoEnabled && authConfig.passwordLogin && (
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-white/8" />
                <span className="text-[9px] uppercase tracking-[0.2em] text-white/25">or</span>
                <div className="h-px flex-1 bg-white/8" />
              </div>
            )}

            {passwordIsSecondary && !showPassword && (
              <button
                onClick={() => setShowPassword(true)}
                className="w-full text-center text-[11px] text-white/35 transition hover:text-white/60"
              >
                Sign in with a password
              </button>
            )}

            {showPasswordForm && (
              <>
                {authConfig.signup && (
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
                )}

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

                {passwordIsSecondary && (
                  <p className="text-center text-[10px] leading-relaxed text-white/25">
                    Password sign-in is reserved for administrator accounts. Everyone else signs in
                    with {authConfig.sso.label ?? 'SSO'}.
                  </p>
                )}
              </>
            )}

            {!showPasswordForm && !passwordIsSecondary && !ssoEnabled && (
              <p className="text-center text-[11px] text-white/35">
                No sign-in method is configured. Contact a GSOC administrator.
              </p>
            )}
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
