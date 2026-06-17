import React, { useState, useEffect } from 'react';
import {
  useCrisisStore,
  type IcsRole,
  IC_COLOR, CMD_COLOR, OPS_COLOR, PLAN_COLOR, LOG_COLOR, FIN_COLOR,
} from './crisisStore';

const WIRE = 'rgba(255,255,255,0.14)';
const WIRE_DASH = `repeating-linear-gradient(to right,${WIRE} 0,${WIRE} 5px,transparent 5px,transparent 10px)`;
const STEM_H = 24;

const PRESET_COLORS = [
  IC_COLOR, CMD_COLOR, OPS_COLOR, PLAN_COLOR, LOG_COLOR, FIN_COLOR,
  '#8b5cf6', '#ec4899', '#06b6d4', '#6b7280',
];

const DRAW_TYPE_LABELS: Record<string, string> = {
  'fire-perimeter': 'Fire Perimeter',
  'burned-area': 'Burned Area',
  'flood-zone': 'Flood Zone',
  'staging-area': 'Staging Area',
  'exclusion-zone': 'Exclusion Zone',
  'search-grid': 'Search Grid',
  'other': 'Other',
};

// ── Primitives ────────────────────────────────────────────────────────────────

function Stem({ h = STEM_H, dashed = false }: { h?: number; dashed?: boolean }) {
  return (
    <div
      className="w-px shrink-0"
      style={{
        height: h,
        background: dashed
          ? `repeating-linear-gradient(to bottom,${WIRE} 0,${WIRE} 4px,transparent 4px,transparent 8px)`
          : WIRE,
      }}
    />
  );
}

function ConnectorRow({ children, dashed = false }: { children: React.ReactNode; dashed?: boolean }) {
  const items = React.Children.toArray(children);
  const n = items.length;
  const sidePct = 50 / n;
  const barStyle = dashed ? WIRE_DASH : WIRE;

  return (
    <div className="relative flex w-full">
      {n > 1 && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 h-px"
          style={{ left: `${sidePct}%`, right: `${sidePct}%`, background: barStyle }}
        />
      )}
      {items.map((child, i) => (
        <div key={i} className="flex flex-1 flex-col items-center">
          <Stem dashed={dashed} />
          {child}
        </div>
      ))}
    </div>
  );
}

// ── Node card ─────────────────────────────────────────────────────────────────

function NodeCard({
  role,
  selected,
  onSelect,
}: {
  role: IcsRole;
  selected: boolean;
  onSelect: () => void;
}) {
  const activeAssignment = useCrisisStore((s) =>
    s.assignments.find((a) => a.roleId === role.id && !a.endedAt)
  );

  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer rounded-md border bg-ink-900 text-center transition-all ${
        selected ? 'ring-1 ring-accent/50' : 'hover:border-white/20'
      }`}
      style={{
        minWidth: role.parentId === null ? '180px' : '120px',
        borderColor: selected ? 'rgba(99,179,237,0.5)' : `${role.color}45`,
      }}
    >
      <div className="h-0.5 w-full rounded-t-md" style={{ background: role.color }} />
      <div className="px-2.5 py-2">
        {role.abbrev && (
          <p className="mb-0.5 text-[8px] font-bold uppercase tracking-[0.14em]" style={{ color: role.color }}>
            {role.abbrev}
          </p>
        )}
        <p className={`font-semibold leading-tight text-white/90 ${role.parentId === null ? 'text-[12px]' : 'text-[10px]'}`}>
          {role.title}
        </p>
        <p className="mt-1 text-[9px] text-white/40">
          {activeAssignment ? activeAssignment.name : '—'}
        </p>
      </div>
    </div>
  );
}

// ── Recursive subtree ─────────────────────────────────────────────────────────

function RoleSubtree({
  roleId,
  selectedId,
  onSelect,
  depth = 0,
}: {
  roleId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  const [kidsCollapsed, setKidsCollapsed] = useState(depth >= 1);
  const role = useCrisisStore((s) => s.roles.find((r) => r.id === roleId));
  const allChildren = useCrisisStore((s) =>
    s.roles.filter((r) => r.parentId === roleId).sort((a, b) => a.order - b.order)
  );

  if (!role) return null;

  const commandKids = allChildren.filter((r) => r.isCommandStaff);
  const regularKids = allChildren.filter((r) => !r.isCommandStaff);
  const hasKids = commandKids.length + regularKids.length > 0;
  const showKids = depth === 0 || !kidsCollapsed;

  return (
    <div className="flex flex-col items-center">
      <NodeCard role={role} selected={role.id === selectedId} onSelect={() => onSelect(role.id)} />

      {/* Command staff advisory section (always visible, no toggle) */}
      {commandKids.length > 0 && (
        <div className="flex w-full flex-col items-center">
          <Stem h={14} dashed />
          <div className="mb-1 flex w-full items-center gap-2 px-2">
            <div className="h-px flex-1" style={{ background: WIRE_DASH }} />
            <span className="shrink-0 text-[7px] font-bold uppercase tracking-[0.16em] text-white/25">
              Command Staff — Advisory
            </span>
            <div className="h-px flex-1" style={{ background: WIRE_DASH }} />
          </div>
          <ConnectorRow dashed>
            {commandKids.map((r) => (
              <RoleSubtree key={r.id} roleId={r.id} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
            ))}
          </ConnectorRow>
        </div>
      )}

      {/* General Staff divider (only when both sections exist) */}
      {commandKids.length > 0 && regularKids.length > 0 && (
        <div className="my-4 flex w-full items-center gap-3 px-1">
          <div className="h-px flex-1" style={{ background: WIRE }} />
          <span className="shrink-0 text-[8px] font-bold uppercase tracking-[0.16em] text-white/28">
            General Staff
          </span>
          <div className="h-px flex-1" style={{ background: WIRE }} />
        </div>
      )}

      {/* Collapse toggle for regular children at depth >= 1 */}
      {depth > 0 && hasKids && (
        <button
          onClick={(e) => { e.stopPropagation(); setKidsCollapsed((v) => !v); }}
          className="mt-2 flex items-center gap-1 rounded border border-white/10 bg-white/4 px-2 py-0.5 text-[8px] text-white/30 transition hover:border-white/20 hover:text-white/55"
        >
          <span style={{ color: role.color }}>{kidsCollapsed ? '▼' : '▲'}</span>
          {kidsCollapsed ? `Expand (${regularKids.length + commandKids.length})` : 'Collapse'}
        </button>
      )}

      {/* Regular staff */}
      {regularKids.length > 0 && showKids && (
        <>
          {commandKids.length === 0 && <Stem />}
          <ConnectorRow>
            {regularKids.map((r) => (
              <RoleSubtree key={r.id} roleId={r.id} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
            ))}
          </ConnectorRow>
        </>
      )}
    </div>
  );
}

// ── Edit panel ────────────────────────────────────────────────────────────────

function EditPanel({ roleId, onClose }: { roleId: string; onClose: () => void }) {
  const role = useCrisisStore((s) => s.roles.find((r) => r.id === roleId));
  const assignments = useCrisisStore((s) =>
    s.assignments.filter((a) => a.roleId === roleId).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )
  );
  const roles = useCrisisStore((s) => s.roles);
  const { updateRole, removeRole, assignRole, endAssignment, addRole } = useCrisisStore();

  const [nameInput, setNameInput] = useState('');
  const [orgInput, setOrgInput] = useState('');
  const [addingChild, setAddingChild] = useState(false);
  const [childTitle, setChildTitle] = useState('');
  const [childAbbrev, setChildAbbrev] = useState('');
  const [childColor, setChildColor] = useState(OPS_COLOR);
  const [childIsCmd, setChildIsCmd] = useState(false);

  const activeAssignment = assignments.find((a) => !a.endedAt);

  useEffect(() => {
    setNameInput(activeAssignment?.name ?? '');
    setOrgInput(activeAssignment?.organization ?? '');
    setAddingChild(false);
  }, [roleId]);

  if (!role) return null;

  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
  };

  const handleAssign = () => {
    const n = nameInput.trim();
    if (!n) return;
    assignRole(roleId, n, orgInput.trim() || undefined);
    setNameInput('');
    setOrgInput('');
  };

  const handleAddChild = () => {
    const t = childTitle.trim();
    if (!t) return;
    const childCount = roles.filter((r) => r.parentId === roleId && r.isCommandStaff === childIsCmd).length;
    addRole({
      title: t,
      abbrev: childAbbrev.trim() || undefined,
      parentId: roleId,
      color: childColor,
      isCommandStaff: childIsCmd,
      order: childCount,
    });
    setChildTitle('');
    setChildAbbrev('');
    setAddingChild(false);
  };

  return (
    <div className="w-64 shrink-0 space-y-4 rounded-lg border border-white/10 bg-ink-900/90 p-4 text-[11px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Role</h4>
        <button onClick={onClose} className="text-white/25 transition hover:text-white/60">✕</button>
      </div>

      {/* Title + abbrev */}
      <div className="space-y-1.5">
        <input
          className="w-full rounded border border-white/8 bg-white/5 px-2 py-1 text-[12px] text-white/80 outline-none focus:border-white/20"
          value={role.title}
          disabled={role.builtin}
          onChange={(e) => updateRole(roleId, { title: e.target.value })}
          placeholder="Role title"
        />
        <input
          className="w-full rounded border border-white/8 bg-white/5 px-2 py-1 text-[10px] text-white/60 outline-none focus:border-white/20"
          value={role.abbrev ?? ''}
          disabled={role.builtin}
          onChange={(e) => updateRole(roleId, { abbrev: e.target.value || undefined })}
          placeholder="Abbreviation (optional)"
        />
        {role.builtin && (
          <p className="text-[9px] text-white/25">Standard NIMS role — title locked</p>
        )}
      </div>

      {/* Color */}
      <div>
        <p className="mb-1.5 text-[9px] uppercase tracking-wider text-white/35">Color</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => updateRole(roleId, { color: c })}
              className="h-5 w-5 rounded-full border-2 transition"
              style={{
                background: c,
                borderColor: role.color === c ? 'white' : 'transparent',
              }}
            />
          ))}
        </div>
      </div>

      {/* Assign personnel */}
      <div>
        <p className="mb-1.5 text-[9px] uppercase tracking-wider text-white/35">
          {activeAssignment ? 'Reassign' : 'Assign Personnel'}
        </p>
        {activeAssignment && (
          <div className="mb-2 flex items-center justify-between rounded border border-white/8 bg-white/5 px-2 py-1.5">
            <div>
              <p className="text-[11px] text-white/80">{activeAssignment.name}</p>
              {activeAssignment.organization && (
                <p className="text-[9px] text-white/40">{activeAssignment.organization}</p>
              )}
            </div>
            <button
              onClick={() => endAssignment(activeAssignment.id)}
              className="text-[9px] text-red-400/60 hover:text-red-400"
            >
              End
            </button>
          </div>
        )}
        <input
          className="mb-1 w-full rounded border border-white/8 bg-white/5 px-2 py-1 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
          placeholder="Full name"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAssign()}
        />
        <input
          className="mb-2 w-full rounded border border-white/8 bg-white/5 px-2 py-1 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
          placeholder="Organization (optional)"
          value={orgInput}
          onChange={(e) => setOrgInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAssign()}
        />
        <button
          onClick={handleAssign}
          disabled={!nameInput.trim()}
          className="w-full rounded bg-accent/15 py-1 text-[10px] text-accent transition hover:bg-accent/25 disabled:opacity-30"
        >
          {activeAssignment ? 'Reassign' : 'Assign'}
        </button>
      </div>

      {/* Assignment history */}
      {assignments.filter((a) => a.endedAt).length > 0 && (
        <div>
          <p className="mb-1.5 text-[9px] uppercase tracking-wider text-white/35">History</p>
          <div className="max-h-28 space-y-1 overflow-y-auto">
            {assignments.filter((a) => a.endedAt).map((a) => (
              <div key={a.id} className="rounded border border-white/6 bg-white/3 px-2 py-1">
                <p className="text-[10px] text-white/55">{a.name}</p>
                <p className="text-[8px] text-white/25">
                  {fmt(a.startedAt)} → {a.endedAt ? fmt(a.endedAt) : 'active'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add child role */}
      <div>
        {!addingChild ? (
          <button
            onClick={() => setAddingChild(true)}
            className="w-full rounded border border-white/10 py-1 text-[10px] text-white/35 transition hover:border-white/20 hover:text-white/55"
          >
            + Add sub-role
          </button>
        ) : (
          <div className="space-y-1.5 rounded border border-white/10 bg-white/3 p-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-white/35">New Sub-role</p>
            <input
              className="w-full rounded border border-white/8 bg-white/5 px-2 py-1 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
              placeholder="Title"
              value={childTitle}
              onChange={(e) => setChildTitle(e.target.value)}
            />
            <input
              className="w-full rounded border border-white/8 bg-white/5 px-2 py-1 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
              placeholder="Abbreviation"
              value={childAbbrev}
              onChange={(e) => setChildAbbrev(e.target.value)}
            />
            <div className="flex flex-wrap gap-1">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setChildColor(c)}
                  className="h-4 w-4 rounded-full border-2 transition"
                  style={{ background: c, borderColor: childColor === c ? 'white' : 'transparent' }}
                />
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-[10px] text-white/40">
              <input type="checkbox" checked={childIsCmd} onChange={(e) => setChildIsCmd(e.target.checked)} />
              Advisory (command staff)
            </label>
            <div className="flex gap-1.5">
              <button onClick={handleAddChild} className="flex-1 rounded bg-accent/15 py-1 text-[10px] text-accent hover:bg-accent/25">
                Add
              </button>
              <button onClick={() => setAddingChild(false)} className="flex-1 rounded border border-white/10 py-1 text-[10px] text-white/35 hover:text-white/55">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete role */}
      {!role.builtin && (
        <button
          onClick={() => {
            if (confirm(`Remove "${role.title}" and all its sub-roles?`)) {
              removeRole(roleId);
              onClose();
            }
          }}
          className="w-full rounded border border-red-500/20 py-1 text-[10px] text-red-400/50 transition hover:border-red-500/40 hover:text-red-400"
        >
          Remove role
        </button>
      )}

      {/* Reset to defaults */}
      <button
        onClick={() => {
          if (confirm('Reset org chart to default ICS/NIMS structure?')) {
            useCrisisStore.getState().resetRoles();
            onClose();
          }
        }}
        className="w-full text-[9px] text-white/20 transition hover:text-white/40"
      >
        Reset to defaults
      </button>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function IcsOrgChart() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rootRoles = useCrisisStore((s) =>
    s.roles.filter((r) => r.parentId === null).sort((a, b) => a.order - b.order)
  );

  const handleSelect = (id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="flex gap-4">
      {/* Scrollable chart */}
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="flex min-w-[820px] flex-col items-center py-2">
          {rootRoles.map((r) => (
            <RoleSubtree key={r.id} roleId={r.id} selectedId={selectedId} onSelect={handleSelect} />
          ))}
        </div>
      </div>

      {/* Edit panel */}
      {selectedId && (
        <EditPanel roleId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
