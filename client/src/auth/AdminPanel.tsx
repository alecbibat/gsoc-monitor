import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from './authStore';
import { INCIDENT_TYPES, incidentTypeDef } from '../crisis/taxonomy';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

interface IapDoc {
  id: string;
  name: string;
  incident_type: string | null;
  size: number;
  updated_at: string;
}

const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// ── IAP library ───────────────────────────────────────────────────────────────
// Which Incident Action Plan PDF serves which incident type on share links.
// One document per type; the "General default" row answers for every type
// without its own upload. This panel is the intended way to change the
// mapping — upload with a type selected to give that type its own IAP.

function IapLibrary() {
  const [docs, setDocs] = useState<IapDoc[]>([]);
  const [uploadType, setUploadType] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    fetch('/api/iap', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows) => setDocs(rows as IapDoc[]))
      .catch(console.error);

  useEffect(() => { load(); }, []);

  const handleUpload = async (file: File) => {
    setError(null);
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setError('Choose a PDF file.'); return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('PDF is larger than 15 MB.'); return;
    }
    setBusy(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/iap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: file.name.replace(/\.pdf$/i, ''),
          incidentType: uploadType || null,
          dataBase64,
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(detail?.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDelete = async (doc: IapDoc) => {
    const label = doc.incident_type ? incidentTypeDef(doc.incident_type).label : 'General default';
    if (!confirm(`Remove the ${label} IAP ("${doc.name}")?`)) return;
    await fetch(`/api/iap/${doc.id}`, { method: 'DELETE', credentials: 'include' }).catch(console.error);
    await load();
  };

  return (
    <div>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/35">
        IAP library — share-link action plans
      </h3>
      <div className="divide-y divide-white/6 rounded-lg border border-white/8">
        {docs.length === 0 && (
          <p className="px-3 py-3 text-[11px] italic text-white/30">No IAP documents uploaded yet.</p>
        )}
        {docs.map((d) => (
          <div key={d.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-white/80">
                {d.incident_type ? incidentTypeDef(d.incident_type).label : 'General default (all types)'}
              </p>
              <p className="truncate text-[10px] text-white/35">
                {d.name} · {fmtSize(d.size)} · {new Date(d.updated_at).toLocaleDateString()}
              </p>
            </div>
            <a
              href={`/api/iap/${d.id}/file`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-[10px] text-white/30 transition hover:text-white/60"
            >
              View
            </a>
            <button
              onClick={() => handleDelete(d)}
              className="shrink-0 text-[10px] text-white/20 transition hover:text-red-400/70"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={uploadType}
          onChange={(e) => setUploadType(e.target.value)}
          className="rounded border border-white/10 bg-ink-900 px-2 py-1.5 text-[11px] text-white/75 outline-none"
        >
          <option value="">General default (all types)</option>
          {INCIDENT_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
          className="text-[10px] text-white/45 file:mr-2 file:rounded file:border file:border-white/12 file:bg-white/6 file:px-2.5 file:py-1 file:text-[10px] file:text-white/60"
        />
        {busy && <span className="text-[10px] text-white/40">Uploading…</span>}
      </div>
      {error && <p className="mt-1.5 text-[10px] text-red-400/80">{error}</p>}
      <p className="mt-1.5 text-[9px] text-white/25">
        Uploading replaces that type's existing document. Share links show the incident type's own IAP,
        falling back to the general default.
      </p>
    </div>
  );
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
      <div className="w-full max-w-lg rounded-xl border border-white/12 bg-ink-900 shadow-2xl">
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

          {/* IAP documents */}
          <IapLibrary />

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
