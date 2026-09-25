import { stableStringify } from './syncCanon';

// ── Three-way rebase of a local incident edit onto a peer's change ───────────
//
// Blob sync is last-write-wins per incident: an edit is debounced for 1.5 s and
// then PUT whole. A peer's change that arrives during that window used to be
// dropped on the floor (the local write "wins"), and the PUT then carried the
// stale copy of every field the peer had changed — so typing in the executive
// summary silently reverted a teammate's status change, role assignment, or
// intake answers. Instead, the sync layer now rebases: starting from the
// server state both sides share (`base`), it keeps what the peer changed and
// re-applies only what THIS tab changed, at the finest grain that is still
// unambiguous:
//
//   - a field only one side changed takes that side's value;
//   - id-keyed arrays (roles, assignments, personnel, draw layers, share
//     links, AAR corrective actions) merge element by element — a peer's
//     added/removed/edited element survives this tab's edit of another one;
//   - plain objects (the intake answer map, the AAR) merge key by key;
//   - arrays of primitives (live layers, extra property groups, vessels)
//     merge as sets;
//   - a genuine conflict — both sides changed the same scalar — keeps the
//     local value, which is what a whole-blob write did before.
//
// Removal wins over an unrelated edit of the same element: a role a peer
// deleted stays deleted even if this tab recolored it (resurrecting it would
// orphan its sub-roles, which the peer's removal also dropped).

type Json = unknown;

const eq = (a: Json, b: Json) => stableStringify(a) === stableStringify(b);

const isPlainObject = (v: Json): v is Record<string, Json> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const isKeyedArray = (v: Json): v is { id: string }[] =>
  Array.isArray(v) && v.every((e) => isPlainObject(e) && typeof e.id === 'string');

const isPrimitiveArray = (v: Json): v is (string | number | boolean | null)[] =>
  Array.isArray(v) && v.every((e) => e === null || typeof e !== 'object');

function mergeValue(base: Json, local: Json, remote: Json): Json {
  if (eq(local, base)) return remote;
  if (eq(remote, base) || eq(remote, local)) return local;
  // Both sides changed it, differently.
  const baseArr = base === undefined ? [] : base;
  if (isKeyedArray(local) && isKeyedArray(remote) && isKeyedArray(baseArr)) {
    return mergeKeyedArrays(baseArr, local, remote);
  }
  if (isPrimitiveArray(local) && isPrimitiveArray(remote) && isPrimitiveArray(baseArr)) {
    return mergeSets(baseArr, local, remote);
  }
  if (isPlainObject(local) && isPlainObject(remote) && (base === undefined || isPlainObject(base))) {
    return mergeObjects((base ?? {}) as Record<string, Json>, local, remote);
  }
  return local;
}

function mergeObjects(
  base: Record<string, Json>,
  local: Record<string, Json>,
  remote: Record<string, Json>,
  exclude: ReadonlySet<string> = new Set()
): Record<string, Json> {
  const out: Record<string, Json> = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  for (const k of keys) {
    const v = exclude.has(k) ? remote[k] : mergeValue(base[k], local[k], remote[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function mergeKeyedArrays<E extends { id: string }>(base: E[], local: E[], remote: E[]): E[] {
  const baseById = new Map(base.map((e) => [e.id, e]));
  const localById = new Map(local.map((e) => [e.id, e]));
  const remoteIds = new Set(remote.map((e) => e.id));

  const out: E[] = [];
  for (const r of remote) {
    const b = baseById.get(r.id);
    const l = localById.get(r.id);
    if (!l) {
      // Absent locally: removed here (it was in base) — or a peer's addition.
      if (b) continue;
      out.push(r);
      continue;
    }
    out.push(mergeValue(b, l, r) as E);
  }

  // This tab's additions, placed after the nearest preceding local element
  // that survived (so a prepended entry stays first, an appended one last).
  local.forEach((l, i) => {
    if (baseById.has(l.id) || remoteIds.has(l.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const idx = out.findIndex((e) => e.id === local[j].id);
      if (idx !== -1) { at = idx + 1; break; }
    }
    out.splice(at, 0, l);
  });
  return out;
}

function mergeSets<P>(base: P[], local: P[], remote: P[]): P[] {
  const removedHere = base.filter((x) => !local.includes(x));
  const addedHere = local.filter((x) => !base.includes(x));
  const out = remote.filter((x) => !removedHere.includes(x));
  for (const x of addedHere) if (!out.includes(x)) out.push(x);
  return out;
}

// ── ICS role tree ────────────────────────────────────────────────────────────
//
// Roles merge one element at a time, which can't see the TREE they form. A
// peer dragging R1 under R2 while this tab dragged R2 under R1 merges into a
// cycle (R1 takes the peer's move, R2 keeps ours); a peer removing role P
// while this tab moved C under P leaves C's parent missing. The chart draws
// from the top-level roles down, so either way those roles and everything
// under them vanish — for every viewer, once the rebased blob is saved.

type RoleNode = { id: string; parentId?: string | null; isCommandStaff?: Json; order?: Json };

/**
 * The roles whose placement breaks the tree: a missing parent, or membership
 * of a cycle. (Roles merely hanging below one are fine once it is fixed.)
 */
function brokenRoles(roles: readonly RoleNode[]): { dangling: Set<string>; cyclic: Set<string> } {
  const byId = new Map(roles.map((r) => [r.id, r]));
  const dangling = new Set<string>();
  const cyclic = new Set<string>();
  const done = new Set<string>();
  for (const r of roles) {
    if (r.parentId != null && !byId.has(r.parentId)) dangling.add(r.id);
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: string | null | undefined = r.id;
    while (cur != null && byId.has(cur) && !done.has(cur) && !onPath.has(cur)) {
      path.push(cur);
      onPath.add(cur);
      cur = byId.get(cur)!.parentId;
    }
    if (cur != null && onPath.has(cur)) for (const id of path.slice(path.indexOf(cur))) cyclic.add(id);
    for (const id of path) done.add(id);
  }
  return { dangling, cyclic };
}

/**
 * Make the merged role list a tree again. A role that breaks it gets its
 * placement (parent, command-staff row, order) back from the peer's copy — the
 * peer's tree is consistent, and two roles can only form a loop if at least
 * one of them moved here, so this undoes the local side of the conflict. A
 * role the peer has no copy of (added here), or that is already placed as the
 * peer placed it, goes under its nearest ancestor still on the chart (by the
 * shared base), else to the top level.
 */
function repairRoleTree<R extends RoleNode>(base: readonly R[], remote: readonly R[], merged: R[]): R[] {
  const baseById = new Map(base.map((r) => [r.id, r]));
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const place = (r: R, parentId: string | null, from: RoleNode = r): R =>
    ({ ...r, parentId, isCommandStaff: parentId === null ? false : from.isCommandStaff, order: from.order });
  const peerPlaced = (r: R) => {
    const peer = remoteById.get(r.id);
    return !peer || ((peer.parentId ?? null) === (r.parentId ?? null) &&
      eq(peer.isCommandStaff, r.isCommandStaff) && eq(peer.order, r.order));
  };
  let out = merged;
  // Every pass moves at least one role, and a role moves at most three times
  // (the peer's placement, an ancestor, the top level) — the bound is never
  // reached on real data; past it, the top level (which can't break the tree)
  // is the last resort.
  const passes = 3 * merged.length + 1;
  for (let pass = 0; pass <= passes; pass++) {
    const { dangling, cyclic } = brokenRoles(out);
    const broken = (r: R) => dangling.has(r.id) || cyclic.has(r.id);
    if (dangling.size === 0 && cyclic.size === 0) return out;
    if (pass === passes) return out.map((r) => (broken(r) ? place(r, null) : r));
    // First undo the local side: back to the peer's placement.
    if (out.some((r) => broken(r) && !peerPlaced(r))) {
      out = out.map((r) => (broken(r) && !peerPlaced(r) ? place(r, remoteById.get(r.id)!.parentId ?? null, remoteById.get(r.id)) : r));
      continue;
    }
    // Still broken as the peer has it (or added here): a missing parent's
    // nearest surviving ancestor; a loop (corrupt data) is cut at one role.
    const ids = new Set(out.map((r) => r.id));
    const cut = [...cyclic][0];
    out = out.map((r) => {
      if (r.id === cut) return place(r, null);
      if (!dangling.has(r.id)) return r;
      let anc = r.parentId ?? null;
      for (let i = 0; anc !== null && !ids.has(anc) && i <= base.length; i++) anc = baseById.get(anc)?.parentId ?? null;
      return place(r, anc !== null && ids.has(anc) ? anc : null);
    });
  }
  return out;
}

/**
 * Rebase this tab's unsaved edit (`local`, diffed against `base`, the server
 * state it started from) onto the server's newer `remote`. Keys in `exclude`
 * take the remote value unmerged — the action log and checklist map sync
 * through their own endpoints and are reconciled separately.
 */
export function rebaseIncident<T extends object>(
  base: object,
  local: T,
  remote: T,
  exclude: readonly string[] = []
): T {
  const out = mergeObjects(
    base as Record<string, Json>,
    local as Record<string, Json>,
    remote as Record<string, Json>,
    new Set(exclude)
  );
  // Roles taken from one side as they are form that side's tree; only a
  // merge of both can break it.
  const b = (base as Record<string, Json>).roles;
  const r = (remote as Record<string, Json>).roles;
  const m = out.roles;
  if (m !== r && isKeyedArray(m) && isKeyedArray(r)) {
    out.roles = repairRoleTree(isKeyedArray(b) ? b : [], r, m);
  }
  return out as T;
}
