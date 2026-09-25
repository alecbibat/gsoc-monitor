import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuthStore } from '../auth/authStore';

// ── Team members ─────────────────────────────────────────────────────────────
// Who has an account, how each one signs in, and pre-creating accounts for
// people who will arrive through single sign-on.

export interface TeamUser {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
  has_password?: boolean;
  sso_linked?: boolean;
  sso_linked_at?: string | null;
}

/**
 * How an account can actually sign in. "Pending" is the state that matters
 * during migration: pre-created, waiting for its owner's first SSO login to
 * link it — it is not a broken row.
 */
export function accessBadge(u: Pick<TeamUser, 'sso_linked' | 'has_password'>): { label: string; cls: string; title: string } {
  if (u.sso_linked) return { label: 'SSO', cls: 'bg-accent/15 text-accent/80', title: 'Signs in with single sign-on' };
  if (u.has_password) return { label: 'Password', cls: 'bg-white/10 text-white/45', title: 'Signs in with a password' };
  return {
    label: 'Pending',
    cls: 'bg-amber-400/15 text-amber-300/80',
    title: 'Created, but not linked yet — links on this person’s first SSO login',
  };
}

/** Case-insensitive match on name or email; blank matches everyone. */
export function filterTeam<U extends Pick<TeamUser, 'name' | 'email'>>(users: readonly U[], query: string): U[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...users];
  return users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
}

const inputCls =
  'w-full rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/85 placeholder-white/25 outline-none focus:border-accent/40';

// ── Provisioning ──────────────────────────────────────────────────────────────

function InviteUser({ onCreated }: { onCreated: (u: TeamUser) => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('member');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, name, role, password: password || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      onCreated(body as TeamUser);
      setEmail(''); setName(''); setPassword(''); setRole('member'); setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded border border-white/12 px-2.5 py-1 text-[10px] text-white/50 transition hover:border-accent/40 hover:text-accent/80"
      >
        + Add member
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Add a team member"
      className="w-full space-y-2 rounded-lg border border-white/10 bg-white/3 p-3"
      onKeyDown={(e) => {
        // Esc cancels the form rather than closing the whole admin page.
        if (e.key === 'Escape' && !busy) { e.preventDefault(); setOpen(false); setError(null); }
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="sr-only">Work email</span>
          <input required type="email" placeholder="work@company.com" value={email} autoFocus
            autoComplete="off"
            onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="sr-only">Full name</span>
          <input required type="text" placeholder="Full name" value={name}
            onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="sr-only">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={`${inputCls} bg-ink-900`}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Password (optional)</span>
          <input type="password" placeholder="Password (optional)" value={password}
            autoComplete="new-password" minLength={8}
            onChange={(e) => setPassword(e.target.value)} className={inputCls} />
        </label>
      </div>
      <p className="text-[10px] leading-relaxed text-white/30">
        Leave the password empty for a single sign-on account — the first SSO login from this email
        address links it automatically. Set one only for a break-glass admin who must be able to
        sign in while the identity provider is down.
      </p>
      {error && <p role="alert" className="text-[10px] text-red-400/85">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy}
          className="rounded bg-accent/20 px-3 py-1.5 text-[11px] font-medium text-accent transition hover:bg-accent/30 disabled:opacity-40">
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }}
          className="rounded border border-white/10 px-3 py-1.5 text-[11px] text-white/45 transition hover:text-white/70">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

export function TeamSection() {
  const me = useAuthStore((s) => s.user);
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Status-checked load: a JSON error body (401 on a lapsed session, 503
  // while Postgres is down) must not reach setUsers — `users.map` would throw
  // during render, and the page's error boundary would replace every section.
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await fetch('/api/admin/users', { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const usrs: unknown = await r.json();
      if (!Array.isArray(usrs)) throw new Error('unexpected response');
      setUsers(usrs as TeamUser[]);
    } catch (e) {
      console.error('[admin] users load failed', e);
      setLoadError('Could not load the team list.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = async (u: TeamUser) => {
    // Removal deletes the account outright, so ask — and be honest that a
    // session already open elsewhere is not cut off by this.
    if (!window.confirm(
      `Remove ${u.name} (${u.email})?\n\nTheir account is deleted and they can no longer sign in. ` +
      'A session they already have open stays signed in until it expires.'
    )) return;
    setDeletingId(u.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE', credentials: 'include' });
      // 404 = already gone (e.g. removed by another admin): dropping the row is still correct.
      if (!res.ok && res.status !== 404) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setUsers((prev) => prev?.filter((x) => x.id !== u.id) ?? prev);
    } catch (e) {
      console.error('[admin] delete user failed', e);
      setActionError(`Could not remove ${u.name}: ${e instanceof Error ? e.message : 'request failed'}`);
    } finally {
      setDeletingId(null);
    }
  };

  const shown = useMemo(() => filterTeam(users ?? [], query), [users, query]);
  const counts = useMemo(() => {
    const list = users ?? [];
    return {
      admins: list.filter((u) => u.role === 'admin').length,
      pending: list.filter((u) => !u.sso_linked && !u.has_password).length,
    };
  }, [users]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 md:px-8 md:py-6">
      <div>
        <h2 className="text-[14px] font-semibold text-white/90">Team members</h2>
        <p className="mt-0.5 text-[11px] text-white/40">
          Everyone with an account. Admins can edit crisis templates, IAP documents and access settings.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[11px] text-white/45">
          {users === null ? '—' : (
            <>
              {users.length} member{users.length === 1 ? '' : 's'}
              {counts.admins > 0 && ` · ${counts.admins} admin${counts.admins === 1 ? '' : 's'}`}
              {counts.pending > 0 && <span className="text-amber-300/75"> · {counts.pending} pending SSO link</span>}
            </>
          )}
        </p>
        {users !== null && users.length > 6 && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or email"
            aria-label="Filter team members"
            className="w-full rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/85 placeholder-white/25 outline-none focus:border-accent/40 sm:w-56"
          />
        )}
        <InviteUser onCreated={(u) => setUsers((prev) => [...(prev ?? []), u])} />
      </div>

      {actionError && (
        <p role="alert" className="rounded border border-red-400/25 bg-red-400/8 px-3 py-2 text-[11px] text-red-300/85">
          {actionError}
        </p>
      )}

      {loadError ? (
        <div className="flex items-center gap-3 rounded-lg border border-red-400/25 bg-red-400/8 px-3 py-2.5">
          <p className="flex-1 text-[11px] text-red-300/85">{loadError}</p>
          <button onClick={() => void load()}
            className="rounded border border-white/15 px-2.5 py-1 text-[10px] text-white/60 transition hover:border-white/30 hover:text-white">
            Retry
          </button>
        </div>
      ) : users === null ? (
        <p className="text-[11px] text-white/35" role="status">Loading team…</p>
      ) : (
        <ul className="divide-y divide-white/6 rounded-lg border border-white/8">
          {shown.length === 0 && (
            <li className="px-3 py-3 text-[11px] italic text-white/30">
              {users.length === 0 ? 'No accounts yet.' : 'No one matches that filter.'}
            </li>
          )}
          {shown.map((u) => {
            const badge = accessBadge(u);
            return (
              <li key={u.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-bold text-accent/80" aria-hidden="true">
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-[12px] font-medium text-white/80">{u.name}</p>
                    {u.id === me?.id && <span className="text-[10px] text-white/35">(you)</span>}
                    {u.role === 'admin' && (
                      <span className="rounded bg-accent/15 px-1 text-[8px] font-bold uppercase tracking-wider text-accent/70">admin</span>
                    )}
                    <span className={`rounded px-1 text-[8px] font-bold uppercase tracking-wider ${badge.cls}`} title={badge.title}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="truncate text-[10px] text-white/35">{u.email}</p>
                </div>
                <p className="hidden shrink-0 text-[9px] text-white/25 sm:block" title="Account created">
                  {new Date(u.created_at).toLocaleDateString()}
                </p>
                {u.id !== me?.id && (
                  <button
                    onClick={() => handleDelete(u)}
                    disabled={deletingId === u.id}
                    className="shrink-0 rounded px-1.5 py-1 text-[10px] text-white/30 transition hover:text-red-400/80 disabled:opacity-40"
                    aria-label={`Remove ${u.name}`}
                  >
                    {deletingId === u.id ? '…' : 'Remove'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
