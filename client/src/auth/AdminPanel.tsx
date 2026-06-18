import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from './authStore';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const me = useAuthStore((s) => s.user);
  const [users, setUsers] = useState<User[]>([]);
  const [signupCode, setSignupCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/users', { credentials: 'include' }).then((r) => r.json()),
      fetch('/api/admin/signup-code', { credentials: 'include' }).then((r) => r.json()),
    ]).then(([usrs, { code }]) => {
      setUsers(usrs as User[]);
      setSignupCode(code as string);
    }).catch(console.error);
  }, []);

  const handleRefreshCode = async () => {
    setRefreshing(true);
    try {
      const { code } = await fetch('/api/admin/signup-code/refresh', {
        method: 'POST', credentials: 'include',
      }).then((r) => r.json()) as { code: string };
      setSignupCode(code);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await fetch(`/api/admin/users/${id}`, { method: 'DELETE', credentials: 'include' });
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  const copyCode = () => {
    if (!signupCode) return;
    navigator.clipboard.writeText(signupCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return createPortal(
    <div className="pointer-events-auto fixed inset-0 z-[4000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-white/12 bg-ink-900/98 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-3.5">
          <span className="text-[12px] font-bold uppercase tracking-[0.15em] text-white/50">Admin</span>
          <button onClick={onClose} className="text-white/30 transition hover:text-white/60">✕</button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5 space-y-6">
          {/* Signup code */}
          <div>
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/35">Signup code</h3>
            <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/4 px-3 py-2">
              <code className="flex-1 font-mono text-[15px] tracking-[0.3em] text-accent/90">
                {signupCode ?? '—'}
              </code>
              <button
                onClick={copyCode}
                className="shrink-0 rounded border border-white/10 px-2.5 py-1 text-[10px] text-white/50 transition hover:border-white/20 hover:text-white"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
              <button
                onClick={handleRefreshCode}
                disabled={refreshing}
                className="shrink-0 rounded border border-white/10 px-2.5 py-1 text-[10px] text-white/50 transition hover:border-white/20 hover:text-white disabled:opacity-40"
              >
                {refreshing ? '…' : 'Refresh'}
              </button>
            </div>
            <p className="mt-1.5 text-[9px] text-white/25">
              Share this code with new team members. Refresh to invalidate the old code.
            </p>
          </div>

          {/* Users */}
          <div>
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/35">
              Team members ({users.length})
            </h3>
            <div className="divide-y divide-white/6 rounded-lg border border-white/8">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-bold text-accent/80">
                    {u.name[0].toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[12px] font-medium text-white/80">{u.name}</p>
                      {u.role === 'admin' && (
                        <span className="rounded bg-accent/15 px-1 text-[8px] font-bold uppercase tracking-wider text-accent/70">admin</span>
                      )}
                    </div>
                    <p className="text-[10px] text-white/35">{u.email}</p>
                  </div>
                  <p className="shrink-0 text-[9px] text-white/25">
                    {new Date(u.created_at).toLocaleDateString()}
                  </p>
                  {u.id !== me?.id && (
                    <button
                      onClick={() => handleDelete(u.id)}
                      disabled={deletingId === u.id}
                      className="shrink-0 text-[10px] text-white/20 transition hover:text-red-400/70 disabled:opacity-40"
                      title="Remove user"
                    >
                      {deletingId === u.id ? '…' : 'Remove'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
