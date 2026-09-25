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
  return mergeObjects(
    base as Record<string, Json>,
    local as Record<string, Json>,
    remote as Record<string, Json>,
    new Set(exclude)
  ) as T;
}
