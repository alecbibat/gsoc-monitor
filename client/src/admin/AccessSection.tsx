import { useEffect, useRef, useState, type ReactNode } from 'react';

// ── Sign-up & share access ───────────────────────────────────────────────────
// The two app-wide access switches: the self-service signup code, and the
// share-link password break-glass.

interface FallbackState {
  active: boolean;
  expiresAt: string | null;
  enabledByName: string | null;
}

function isFallbackState(v: unknown): v is FallbackState {
  return !!v && typeof v === 'object' && typeof (v as FallbackState).active === 'boolean';
}

const FALLBACK_HOURS = [1, 4, 8, 12, 24, 48, 72];

const btnCls =
  'shrink-0 rounded border border-white/10 px-2.5 py-1 text-[10px] text-white/50 transition hover:border-white/20 hover:text-white disabled:opacity-40';

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/35">{children}</h3>;
}

// ── Signup code ───────────────────────────────────────────────────────────────

function SignupCodePanel() {
  const [signupCode, setSignupCode] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const codeRef = useRef<HTMLElement>(null);
  const copiedTimer = useRef<number | undefined>(undefined);

  // Status-checked: a JSON error body (401 on a lapsed session, 503 while
  // Postgres is down) must not be mistaken for a code.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/signup-code', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`signup-code ${r.status}`))))
      .then((body) => {
        if (cancelled) return;
        const code = (body as { code?: unknown } | null)?.code;
        setSignupCode(typeof code === 'string' ? code : null);
      })
      .catch((e) => { console.error(e); if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; window.clearTimeout(copiedTimer.current); };
  }, []);

  const handleRefreshCode = async () => {
    if (!window.confirm('Issue a new signup code? The current code stops working immediately.')) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch('/api/admin/signup-code/refresh', {
        method: 'POST', credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { code } = (await res.json()) as { code?: unknown };
      // Keep showing the old (still valid) code unless the server really rotated it.
      if (typeof code === 'string') { setSignupCode(code); setLoadError(false); }
    } catch (e) {
      console.error('[admin] signup code refresh failed', e);
      setRefreshError('Could not issue a new code — the current one is still valid.');
    } finally {
      setRefreshing(false);
    }
  };

  const copyCode = () => {
    if (!signupCode) return;
    const done = () => {
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    };
    // No clipboard API outside a secure context: select the code instead so
    // Ctrl/Cmd+C still works.
    const selectCode = () => {
      const el = codeRef.current;
      const sel = window.getSelection();
      if (!el || !sel) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(signupCode).then(done, selectCode);
    else selectCode();
  };

  return (
    <div>
      <SectionTitle>Signup code</SectionTitle>
      <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/4 px-3 py-2">
        <code ref={codeRef} className="min-w-0 flex-1 truncate font-mono text-[15px] tracking-[0.3em] text-accent/90">
          {signupCode ?? '—'}
        </code>
        <button onClick={copyCode} disabled={!signupCode} className={btnCls}>
          <span aria-live="polite">{copied ? '✓ Copied' : 'Copy'}</span>
        </button>
        <button onClick={handleRefreshCode} disabled={refreshing} className={btnCls}>
          {refreshing ? '…' : 'Refresh'}
        </button>
      </div>
      {loadError && <p className="mt-1.5 text-[10px] text-red-400/80">Could not load the current code.</p>}
      {refreshError && <p role="alert" className="mt-1.5 text-[10px] text-red-400/80">{refreshError}</p>}
      <p className="mt-1.5 text-[10px] text-white/30">
        Share this code with new team members. Refresh to invalidate the old code.
      </p>
    </div>
  );
}

// ── Share-link break-glass ────────────────────────────────────────────────────
//
// Share links require a signed-in account. This opens a time-boxed window in
// which the link password works again — for an IdP outage, which is exactly the
// kind of incident this app exists to coordinate. It closes itself.

function ShareFallbackPanel() {
  const [state, setState] = useState<FallbackState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [hours, setHours] = useState(12);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetch('/api/admin/share-fallback', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s) => {
        if (!isFallbackState(s)) throw new Error('unexpected response');
        setState(s);
        setLoadError(false);
      })
      .catch((e) => { console.error(e); setLoadError(true); });

  useEffect(() => { void load(); }, []);

  const set = async (on: boolean) => {
    // Widening who can read every live share link deserves a second look;
    // turning it off never does.
    if (on && !window.confirm(
      `Accept share-link passwords for ${hours} hour${hours === 1 ? '' : 's'}?\n\n` +
      'Anyone holding a link and its password will be able to read that incident without signing in.'
    )) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/share-fallback', {
        method: on ? 'POST' : 'DELETE',
        headers: on ? { 'Content-Type': 'application/json' } : undefined,
        credentials: 'include',
        body: on ? JSON.stringify({ hours }) : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next: unknown = await res.json();
      if (!isFallbackState(next)) throw new Error('unexpected response');
      setState(next);
    } catch (e) {
      console.error(e);
      setError(on ? 'Could not enable break-glass access.' : 'Could not turn break-glass access off — try again.');
      void load(); // show what the server actually has now
    } finally {
      setBusy(false);
    }
  };

  const active = state?.active ?? false;

  return (
    <div>
      <SectionTitle>Share-link access</SectionTitle>
      <div
        className={`rounded-lg border px-3 py-2.5 ${
          active ? 'border-amber-400/35 bg-amber-400/8' : 'border-white/8 bg-white/4'
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              state === null ? 'bg-white/20' : active ? 'animate-pulse bg-amber-400' : 'bg-green-500'
            }`}
            aria-hidden="true"
          />
          <p className="flex-1 text-[12px] font-medium text-white/80" aria-live="polite">
            {state === null ? (loadError ? 'Status unavailable' : 'Checking…') : active ? 'Link passwords accepted' : 'Sign-in required'}
          </p>
          <button
            onClick={() => set(!active)}
            disabled={busy || state === null}
            className={`shrink-0 rounded border px-2.5 py-1 text-[10px] transition disabled:opacity-40 ${
              active
                ? 'border-white/15 text-white/60 hover:border-white/30 hover:text-white'
                : 'border-amber-400/30 text-amber-300/80 hover:border-amber-400/60 hover:text-amber-200'
            }`}
          >
            {busy ? '…' : active ? 'Turn off now' : 'Enable break-glass'}
          </button>
        </div>

        {active && state?.expiresAt && (
          <p className="mt-1.5 text-[10px] text-amber-200/70">
            Open until {new Date(state.expiresAt).toLocaleString()}
            {state.enabledByName ? ` · enabled by ${state.enabledByName}` : ''}
          </p>
        )}

        {!active && state !== null && (
          <div className="mt-2 flex items-center gap-2">
            <label htmlFor="share-fallback-hours" className="text-[10px] text-white/35">Window</label>
            <select
              id="share-fallback-hours"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="rounded border border-white/10 bg-ink-900 px-2 py-1 text-[10px] text-white/70 outline-none focus:border-accent/40"
            >
              {FALLBACK_HOURS.map((h) => (
                <option key={h} value={h}>{h} hour{h === 1 ? '' : 's'}</option>
              ))}
            </select>
          </div>
        )}

        {loadError && state === null && (
          <button onClick={() => void load()} className="mt-2 text-[10px] text-white/45 underline-offset-2 hover:text-white/75 hover:underline">
            Retry
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-1.5 text-[10px] text-red-400/80">{error}</p>}
      <p className="mt-1.5 text-[10px] leading-relaxed text-white/30">
        Normally every share-link viewer must sign in. Enable this only if single sign-on is
        unavailable and a report still has to reach people — it lets anyone holding a link and its
        password read that incident. It switches itself off when the window ends.
      </p>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

export function AccessSection() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-5 md:px-8 md:py-6">
      <div>
        <h2 className="text-[14px] font-semibold text-white/90">Sign-up &amp; share access</h2>
        <p className="mt-0.5 text-[11px] text-white/40">
          How new people get an account, and the emergency switch for share links when sign-in is down.
        </p>
      </div>
      <SignupCodePanel />
      <ShareFallbackPanel />
    </div>
  );
}
