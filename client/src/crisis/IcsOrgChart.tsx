import React, { useState } from 'react';
import { useCrisisStore } from './crisisStore';

// Wire/connector colour for all tree lines
const WIRE = 'rgba(255,255,255,0.14)';
const STEM_H = 26; // px per vertical connector segment

// ─── Primitives ───────────────────────────────────────────────────────────────

// Vertical connector stem
function Stem({ h = STEM_H, dashed = false }: { h?: number; dashed?: boolean }) {
  return (
    <div
      className="w-px shrink-0"
      style={{
        height: h,
        background: dashed
          ? `repeating-linear-gradient(to bottom, ${WIRE} 0px, ${WIRE} 4px, transparent 4px, transparent 8px)`
          : WIRE,
      }}
    />
  );
}

// Branching connector: draws a horizontal bar between child centres, then a
// vertical drop to each child. Children must be wrapped in flex-1 divs to
// ensure equal sizing.
function ConnectorRow({
  children,
  dashed = false,
}: {
  children: React.ReactNode;
  dashed?: boolean;
}) {
  const items = React.Children.toArray(children);
  const n = items.length;
  const sidePct = 50 / n; // % from each side where the first/last child centre sits
  const wireStyle = dashed
    ? `repeating-linear-gradient(to right, ${WIRE} 0px, ${WIRE} 6px, transparent 6px, transparent 12px)`
    : WIRE;

  return (
    <div className="relative flex w-full">
      {n > 1 && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 h-px"
          style={{ left: `${sidePct}%`, right: `${sidePct}%`, background: wireStyle }}
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

// ─── Org Chart Node ───────────────────────────────────────────────────────────

function IcsNode({
  id,
  title,
  abbrev,
  color,
  large = false,
  role,
}: {
  id: string;
  title: string;
  abbrev?: string;
  color: string;
  large?: boolean;
  role?: string;
}) {
  const name = useCrisisStore((s) => s.personnel[id] ?? '');
  const setPersonnel = useCrisisStore((s) => s.setPersonnel);

  return (
    <div
      className={`relative overflow-hidden rounded-md border bg-ink-900 text-center ${
        large ? 'min-w-[192px]' : 'min-w-[128px]'
      }`}
      style={{ borderColor: `${color}45` }}
    >
      {/* Top colour bar */}
      <div className="h-0.5 w-full" style={{ background: color }} />

      <div className={`px-3 pb-2 pt-2 ${large ? 'pb-2.5' : ''}`}>
        {abbrev && (
          <p
            className="mb-0.5 text-[8px] font-bold uppercase tracking-[0.14em]"
            style={{ color }}
          >
            {abbrev}
          </p>
        )}
        <p
          className={`font-semibold leading-tight text-white/90 ${
            large ? 'text-[13px]' : 'text-[10px]'
          }`}
        >
          {title}
        </p>
        {role && (
          <p className="mt-0.5 text-[8px] text-white/30">{role}</p>
        )}
        <input
          className="mt-1.5 w-full rounded bg-white/5 px-1.5 py-1 text-center text-[9px] text-white/45 placeholder-white/18 outline-none transition focus:bg-white/8 focus:text-white/80 pointer-events-auto"
          placeholder="Unassigned"
          value={name}
          onChange={(e) => setPersonnel(id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}

// ─── Expandable Sub-unit Section ──────────────────────────────────────────────

interface SubUnit {
  id: string;
  title: string;
  abbrev?: string;
}

function SubSection({ units, color }: { units: SubUnit[]; color: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col items-center">
      <Stem h={18} />
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded border border-white/10 bg-white/4 px-2 py-0.5 text-[8px] font-medium uppercase tracking-wide text-white/30 transition hover:border-white/20 hover:text-white/55 pointer-events-auto"
      >
        <span style={{ color }}>{open ? '▲' : '▼'}</span>
        {open ? 'Collapse' : 'Expand'} units
      </button>
      {open && (
        <ConnectorRow>
          {units.map((u) => (
            <IcsNode key={u.id} id={u.id} title={u.title} abbrev={u.abbrev} color={color} />
          ))}
        </ConnectorRow>
      )}
    </div>
  );
}

// ─── ICS Colours (FEMA standard section colours) ─────────────────────────────

const IC_COLOR   = '#fbbf24'; // Gold
const CMD_COLOR  = '#f97316'; // Orange — Command Staff (advisory)
const OPS_COLOR  = '#ef4444'; // Red    — Operations
const PLAN_COLOR = '#3b82f6'; // Blue   — Planning
const LOG_COLOR  = '#eab308'; // Yellow — Logistics
const FIN_COLOR  = '#22c55e'; // Green  — Finance/Admin

// ─── Chart ────────────────────────────────────────────────────────────────────

export function IcsOrgChart() {
  return (
    <div className="flex min-w-[820px] flex-col items-center py-2">

      {/* Level 1 — Incident Commander */}
      <IcsNode id="ic" title="Incident Commander" abbrev="IC" color={IC_COLOR} large />
      <Stem />

      {/* Level 2 — Command Staff (advisory — dashed connection) */}
      <div className="mb-1 flex w-full items-center gap-2 px-1">
        <div
          className="h-px flex-1"
          style={{
            background: `repeating-linear-gradient(to right, ${WIRE} 0px, ${WIRE} 5px, transparent 5px, transparent 10px)`,
          }}
        />
        <span className="shrink-0 text-[8px] font-bold uppercase tracking-[0.16em] text-white/25">
          Command Staff — Advisory
        </span>
        <div
          className="h-px flex-1"
          style={{
            background: `repeating-linear-gradient(to right, ${WIRE} 0px, ${WIRE} 5px, transparent 5px, transparent 10px)`,
          }}
        />
      </div>

      <ConnectorRow dashed>
        <IcsNode id="safety"  title="Safety Officer"                abbrev="SO"  color={CMD_COLOR} />
        <IcsNode id="pio"     title="Public Information Officer"     abbrev="PIO" color={CMD_COLOR} />
        <IcsNode id="liaison" title="Liaison Officer"               abbrev="LO"  color={CMD_COLOR} />
      </ConnectorRow>

      {/* General Staff divider */}
      <div className="my-5 flex w-full items-center gap-3 px-1">
        <div className="h-px flex-1" style={{ background: WIRE }} />
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.16em] text-white/28">
          General Staff
        </span>
        <div className="h-px flex-1" style={{ background: WIRE }} />
      </div>

      {/* Level 3 — Section Chiefs + their sub-units ─────────────────────────── */}
      <div className="relative flex w-full">
        {/* Horizontal bar across all 4 section columns */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 h-px"
          style={{ left: '12.5%', right: '12.5%', background: WIRE }}
        />

        {/* Operations */}
        <div className="flex flex-1 flex-col items-center">
          <Stem />
          <IcsNode id="ops"      title="Operations Section Chief"   abbrev="OSC" color={OPS_COLOR} />
          <SubSection color={OPS_COLOR} units={[
            { id: 'ops-branch',   title: 'Branch Directors' },
            { id: 'ops-division', title: 'Division/Group Supervisors' },
            { id: 'ops-air',      title: 'Air Operations Branch' },
            { id: 'ops-staging',  title: 'Staging Area Manager' },
          ]} />
        </div>

        {/* Planning */}
        <div className="flex flex-1 flex-col items-center">
          <Stem />
          <IcsNode id="planning" title="Planning Section Chief"     abbrev="PSC" color={PLAN_COLOR} />
          <SubSection color={PLAN_COLOR} units={[
            { id: 'plan-resources', title: 'Resources Unit',       abbrev: 'RESL' },
            { id: 'plan-situation', title: 'Situation Unit',       abbrev: 'SITL' },
            { id: 'plan-docs',      title: 'Documentation Unit',   abbrev: 'DOCL' },
            { id: 'plan-demob',     title: 'Demobilization Unit',  abbrev: 'DMBL' },
          ]} />
        </div>

        {/* Logistics */}
        <div className="flex flex-1 flex-col items-center">
          <Stem />
          <IcsNode id="logistics" title="Logistics Section Chief"  abbrev="LSC" color={LOG_COLOR} />
          <SubSection color={LOG_COLOR} units={[
            { id: 'log-support',    title: 'Support Branch Director' },
            { id: 'log-service',    title: 'Service Branch Director' },
            { id: 'log-supply',     title: 'Supply Unit',          abbrev: 'SPUL' },
            { id: 'log-facilities', title: 'Facilities Unit',      abbrev: 'FACL' },
          ]} />
        </div>

        {/* Finance / Admin */}
        <div className="flex flex-1 flex-col items-center">
          <Stem />
          <IcsNode id="finance"  title="Finance/Admin Section Chief" abbrev="FSC" color={FIN_COLOR} />
          <SubSection color={FIN_COLOR} units={[
            { id: 'fin-time', title: 'Time Unit',               abbrev: 'TIME' },
            { id: 'fin-proc', title: 'Procurement Unit',        abbrev: 'PROC' },
            { id: 'fin-comp', title: 'Compensation/Claims Unit', abbrev: 'COMP' },
            { id: 'fin-cost', title: 'Cost Unit',               abbrev: 'COST' },
          ]} />
        </div>
      </div>
    </div>
  );
}
