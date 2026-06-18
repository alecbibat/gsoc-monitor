import React, { useState, useEffect, useRef } from 'react';
import {
  useCrisisStore, selectActive,
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
  onRemoved,
}: {
  role: IcsRole;
  selected: boolean;
  onSelect: () => void;
  onRemoved?: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const activeAssignments = useCrisisStore((s) =>
    (selectActive(s)?.assignments ?? []).filter((a) => a.roleId === role.id && !a.endedAt)
  );
  const personnel = useCrisisStore((s) => selectActive(s)?.personnel ?? []);
  const assignRole = useCrisisStore((s) => s.assignRole);
  const removeRole = useCrisisStore((s) => s.removeRole);

  const isEmpty = activeAssignments.length === 0;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const memberId = e.dataTransfer.getData('personnel-id');
    const member = personnel.find((p) => p.id === memberId);
    if (member) assignRole(role.id, member.name, member.organization);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Remove "${role.title}"?`)) {
      removeRole(role.id);
      onRemoved?.();
    }
  };

  return (
    <div
      onClick={onSelect}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group relative cursor-pointer rounded-md border bg-ink-900 text-center transition-all ${
        selected ? 'ring-1 ring-accent/50' : 'hover:border-white/20'
      } ${dragOver ? 'ring-1 ring-accent/60' : ''}`}
      style={{
        minWidth: role.parentId === null ? '180px' : '120px',
        borderColor: selected ? 'rgba(99,179,237,0.5)' : dragOver ? 'rgba(99,179,237,0.4)' : `${role.color}45`,
      }}
    >
      {/* Remove button — visible on hover when empty */}
      {isEmpty && (
        <button
          onClick={handleRemove}
          className="absolute -right-1.5 -top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full border border-white/15 bg-ink-900 text-[8px] text-white/30 opacity-0 transition-opacity hover:border-red-500/40 hover:text-red-400/80 group-hover:opacity-100"
          title="Remove role"
        >
          ×
        </button>
      )}

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

        {role.isSupport ? (
          activeAssignments.length > 0 ? (
            <div className="mt-1 space-y-0.5">
              {activeAssignments.map((a) => (
                <p key={a.id} className="text-[9px] text-white/45 leading-tight">{a.name}</p>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[9px] text-white/20">Drop to assign</p>
          )
        ) : (
          <p className="mt-1 text-[9px] text-white/40">
            {activeAssignments[0] ? activeAssignments[0].name : '—'}
          </p>
        )}

        {dragOver && (
          <p className="mt-0.5 text-[8px] text-accent/70">Drop to assign</p>
        )}
      </div>

      {role.isSupport && (
        <div
          className="flex items-center justify-center pb-1 text-[7px] font-bold uppercase tracking-widest"
          style={{ color: role.color, opacity: 0.5 }}
        >
          support
        </div>
      )}
    </div>
  );
}

// ── Recursive subtree ─────────────────────────────────────────────────────────

function RoleSubtree({
  roleId,
  selectedId,
  onSelect,
  onRemoved,
  depth = 0,
}: {
  roleId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemoved?: () => void;
  depth?: number;
}) {
  const [kidsCollapsed, setKidsCollapsed] = useState(depth >= 1);
  const role = useCrisisStore((s) => selectActive(s)?.roles.find((r) => r.id === roleId));
  const allChildren = useCrisisStore((s) =>
    (selectActive(s)?.roles ?? []).filter((r) => r.parentId === roleId).sort((a, b) => a.order - b.order)
  );

  if (!role) return null;

  const commandKids = allChildren.filter((r) => r.isCommandStaff);
  const regularKids = allChildren.filter((r) => !r.isCommandStaff);
  const hasKids = commandKids.length + regularKids.length > 0;
  const showKids = depth === 0 || !kidsCollapsed;

  return (
    <div className="flex flex-col items-center">
      <NodeCard
        role={role}
        selected={role.id === selectedId}
        onSelect={() => onSelect(role.id)}
        onRemoved={onRemoved}
      />

      {/* Command staff advisory section */}
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

      {/* General Staff divider */}
      {commandKids.length > 0 && regularKids.length > 0 && (
        <div className="my-4 flex w-full items-center gap-3 px-1">
          <div className="h-px flex-1" style={{ background: WIRE }} />
          <span className="shrink-0 text-[8px] font-bold uppercase tracking-[0.16em] text-white/28">
            General Staff
          </span>
          <div className="h-px flex-1" style={{ background: WIRE }} />
        </div>
      )}

      {/* Collapse toggle */}
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

// ── Personnel Pool ────────────────────────────────────────────────────────────

function PersonnelPool() {
  const personnel = useCrisisStore((s) => selectActive(s)?.personnel ?? []);
  const addPersonnelMember = useCrisisStore((s) => s.addPersonnelMember);
  const removePersonnelMember = useCrisisStore((s) => s.removePersonnelMember);

  const [adding, setAdding] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [orgInput, setOrgInput] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) nameRef.current?.focus();
  }, [adding]);

  const handleAdd = () => {
    const n = nameInput.trim();
    if (!n) return;
    addPersonnelMember(n, orgInput.trim() || undefined);
    setNameInput('');
    setOrgInput('');
  };

  const handleDragStart = (e: React.DragEvent, memberId: string) => {
    e.dataTransfer.setData('personnel-id', memberId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="border-t border-white/8 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-wider text-white/35">Personnel Pool</span>
          {personnel.length > 0 && (
            <span className="rounded bg-white/6 px-1.5 py-0.5 text-[8px] text-white/30">{personnel.length}</span>
          )}
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-[10px] text-white/30 transition hover:text-white/60"
        >
          {adding ? '✕ Cancel' : '+ Add person'}
        </button>
      </div>

      {adding && (
        <div className="mb-3 flex gap-2">
          <input
            ref={nameRef}
            className="flex-1 rounded border border-white/8 bg-white/8 px-2 py-1.5 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
            placeholder="Full name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <input
            className="flex-1 rounded border border-white/8 bg-white/8 px-2 py-1.5 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
            placeholder="Organization (optional)"
            value={orgInput}
            onChange={(e) => setOrgInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button
            onClick={handleAdd}
            disabled={!nameInput.trim()}
            className="rounded bg-accent/15 px-3 text-[10px] text-accent transition hover:bg-accent/25 disabled:opacity-30"
          >
            Add
          </button>
        </div>
      )}

      {personnel.length === 0 && !adding ? (
        <p className="text-[10px] text-white/20">
          Add people here, then drag them onto roles above to assign.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {personnel.map((member) => (
            <div
              key={member.id}
              draggable
              onDragStart={(e) => handleDragStart(e, member.id)}
              className="group flex cursor-grab items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/60 transition hover:border-white/18 active:cursor-grabbing"
            >
              <span className="text-white/25 select-none">⠿</span>
              <span>{member.name}</span>
              {member.organization && (
                <span className="text-white/30">· {member.organization}</span>
              )}
              <button
                onClick={() => removePersonnelMember(member.id)}
                className="ml-0.5 text-white/15 opacity-0 transition hover:text-red-400/70 group-hover:opacity-100"
                title="Remove from pool"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Edit panel ────────────────────────────────────────────────────────────────

function EditPanel({ roleId, onClose }: { roleId: string; onClose: () => void }) {
  const role = useCrisisStore((s) => selectActive(s)?.roles.find((r) => r.id === roleId));
  const assignments = useCrisisStore((s) =>
    (selectActive(s)?.assignments ?? []).filter((a) => a.roleId === roleId).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )
  );
  const roles = useCrisisStore((s) => selectActive(s)?.roles ?? []);
  const updateRole    = useCrisisStore((s) => s.updateRole);
  const removeRole    = useCrisisStore((s) => s.removeRole);
  const assignRole    = useCrisisStore((s) => s.assignRole);
  const endAssignment = useCrisisStore((s) => s.endAssignment);
  const addRole       = useCrisisStore((s) => s.addRole);

  const [nameInput, setNameInput] = useState('');
  const [orgInput, setOrgInput] = useState('');
  const [addingChild, setAddingChild] = useState(false);
  const [childTitle, setChildTitle] = useState('');
  const [childAbbrev, setChildAbbrev] = useState('');
  const [childColor, setChildColor] = useState(OPS_COLOR);
  const [childIsCmd, setChildIsCmd] = useState(false);
  const [childIsSupport, setChildIsSupport] = useState(false);

  const activeAssignments = assignments.filter((a) => !a.endedAt);
  const activeAssignment = activeAssignments[0];

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
      isSupport: childIsSupport,
      order: childCount,
    });
    setChildTitle('');
    setChildAbbrev('');
    setChildIsSupport(false);
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
          className="w-full rounded border border-white/8 bg-white/10 px-2 py-1 text-[12px] text-white/80 outline-none focus:border-white/20 disabled:opacity-50"
          value={role.title}
          disabled={role.builtin}
          onChange={(e) => updateRole(roleId, { title: e.target.value })}
          placeholder="Role title"
        />
        <input
          className="w-full rounded border border-white/8 bg-white/10 px-2 py-1 text-[10px] text-white/60 outline-none focus:border-white/20 disabled:opacity-50"
          value={role.abbrev ?? ''}
          disabled={role.builtin}
          onChange={(e) => updateRole(roleId, { abbrev: e.target.value || undefined })}
          placeholder="Abbreviation (optional)"
        />
        {role.builtin && (
          <p className="text-[9px] text-white/25">Standard NIMS role — title locked</p>
        )}
      </div>

      {/* Support role toggle */}
      <label className="flex cursor-pointer items-center gap-2 text-[10px] text-white/40 hover:text-white/60">
        <input
          type="checkbox"
          checked={role.isSupport}
          onChange={(e) => updateRole(roleId, { isSupport: e.target.checked })}
          className="accent-accent"
        />
        <span>Support role <span className="text-white/25">(multiple concurrent assignments)</span></span>
      </label>

      {/* Color */}
      <div>
        <p className="mb-1.5 text-[9px] uppercase tracking-wider text-white/35">Color</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => updateRole(roleId, { color: c })}
              className="h-5 w-5 rounded-full border-2 transition"
              style={{ background: c, borderColor: role.color === c ? 'white' : 'transparent' }}
            />
          ))}
        </div>
      </div>

      {/* Active assignments */}
      {role.isSupport && activeAssignments.length > 0 && (
        <div>
          <p className="mb-1.5 text-[9px] uppercase tracking-wider text-white/35">Currently Assigned</p>
          <div className="space-y-1">
            {activeAssignments.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded border border-white/8 bg-white/8 px-2 py-1.5">
                <div>
                  <p className="text-[11px] text-white/80">{a.name}</p>
                  {a.organization && <p className="text-[9px] text-white/40">{a.organization}</p>}
                </div>
                <button onClick={() => endAssignment(a.id)} className="text-[9px] text-red-400/60 hover:text-red-400">End</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assign personnel */}
      <div>
        <p className="mb-1.5 text-[9px] uppercase tracking-wider text-white/35">
          {role.isSupport ? 'Add Personnel' : activeAssignment ? 'Reassign' : 'Assign Personnel'}
        </p>
        {!role.isSupport && activeAssignment && (
          <div className="mb-2 flex items-center justify-between rounded border border-white/8 bg-white/10 px-2 py-1.5">
            <div>
              <p className="text-[11px] text-white/80">{activeAssignment.name}</p>
              {activeAssignment.organization && (
                <p className="text-[9px] text-white/40">{activeAssignment.organization}</p>
              )}
            </div>
            <button onClick={() => endAssignment(activeAssignment.id)} className="text-[9px] text-red-400/60 hover:text-red-400">End</button>
          </div>
        )}
        <input
          className="mb-1 w-full rounded border border-white/8 bg-white/10 px-2 py-1 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
          placeholder="Full name"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAssign()}
        />
        <input
          className="mb-2 w-full rounded border border-white/8 bg-white/10 px-2 py-1 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
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
          {role.isSupport ? 'Add to Role' : activeAssignment ? 'Reassign' : 'Assign'}
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
              className="w-full rounded border border-white/8 bg-white/10 px-2 py-1 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
              placeholder="Title"
              value={childTitle}
              onChange={(e) => setChildTitle(e.target.value)}
            />
            <input
              className="w-full rounded border border-white/8 bg-white/10 px-2 py-1 text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
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
            <label className="flex items-center gap-1.5 text-[10px] text-white/40">
              <input type="checkbox" checked={childIsSupport} onChange={(e) => setChildIsSupport(e.target.checked)} />
              Support role (multiple people)
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

      {/* Delete role — available for any role when empty */}
      {(() => {
        const activeCount = assignments.filter((a) => !a.endedAt).length;
        if (activeCount > 0) return null;
        return (
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
        );
      })()}

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRoles = useCrisisStore((s) =>
    (selectActive(s)?.roles ?? []).filter((r) => r.parentId === null).sort((a, b) => a.order - b.order)
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
    });
  }, [rootRoles.length]);

  const handleSelect = (id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="flex flex-col gap-0">
      <div className="flex gap-4">
        {/* Scrollable chart */}
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
          <div className="flex w-max min-w-full flex-col items-center py-4">
            {rootRoles.map((r) => (
              <RoleSubtree
                key={r.id}
                roleId={r.id}
                selectedId={selectedId}
                onSelect={handleSelect}
                onRemoved={() => { if (selectedId === r.id) setSelectedId(null); }}
              />
            ))}
          </div>
        </div>

        {/* Edit panel */}
        {selectedId && (
          <EditPanel roleId={selectedId} onClose={() => setSelectedId(null)} />
        )}
      </div>

      <PersonnelPool />
    </div>
  );
}
