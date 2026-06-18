import { useState } from 'react';
import { useAuthStore } from './authStore';
import { AdminPanel } from './AdminPanel';

export function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [open, setOpen] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  if (!user) return null;

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
  };

  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-accent/15 text-[11px] font-bold text-accent/80 shadow-panel backdrop-blur-sm transition hover:border-accent/30 hover:text-accent"
          title={user.name}
        >
          {initials}
        </button>

        {open && (
          <>
            <div className="pointer-events-auto fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="pointer-events-auto absolute left-0 top-full z-50 mt-1.5 w-48 rounded-lg border border-white/12 bg-ink-900/98 shadow-2xl backdrop-blur-sm">
              <div className="border-b border-white/8 px-3 py-2.5">
                <p className="text-[12px] font-semibold text-white/80">{user.name}</p>
                <p className="text-[10px] text-white/35">{user.email}</p>
              </div>
              <div className="p-1">
                {user.role === 'admin' && (
                  <button
                    onClick={() => { setOpen(false); setShowAdmin(true); }}
                    className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-[11px] text-white/60 transition hover:bg-white/6 hover:text-white"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                    </svg>
                    Admin panel
                  </button>
                )}
                <button
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-[11px] text-white/40 transition hover:bg-red-400/8 hover:text-red-400/80"
                >
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                  </svg>
                  Sign out
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </>
  );
}
