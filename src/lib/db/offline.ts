import { applySort, matches, type Where } from "./local";
import type { EntityName, Id } from "./types";

/**
 * Offline support, as pure logic.
 *
 * Nothing in this file touches the network or a storage API, so the rules that
 * decide what an unsent write does to the local copy - and what gets thrown
 * away before a queue is replayed - can be tested on their own.
 *
 * Two things are kept per signed-in user:
 *
 * - a **snapshot**: the last rows the server returned, so a read with no
 *   network answers from real data instead of an empty screen.
 * - an **outbox**: the writes that could not be sent yet, in the order they
 *   were made.
 */

export type PendingKind =
  | "create"
  | "update"
  | "delete"
  | "bulkCreate"
  | "bulkUpdate"
  | "deleteMany";

export type PendingOp = {
  /** Client-side identity of the queued operation, not of the row. */
  id: string;
  kind: PendingKind;
  table: EntityName;
  /** The row data for a write, or the id for a delete. */
  payload: unknown;
  /** `deleteMany` only: the rows it was asked to remove. */
  where?: Where;
  queuedAt: number;
};

/** Cached rows per table, keyed by user id. */
export type Snapshot = Partial<Record<EntityName, Record<Id, unknown>>>;

export const emptySnapshot = (): Snapshot => ({});

export function rowsOf(snapshot: Snapshot, table: EntityName): Record<Id, unknown>[] {
  return Object.values(snapshot[table] ?? {}) as Record<Id, unknown>[];
}

const idOf = (row: unknown): Id | null =>
  row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"
    ? ((row as { id: string }).id as Id)
    : null;

/**
 * Thrown when a request never reached a server.
 *
 * This is the only thing that counts as "offline". Classifying failures by
 * their type instead is how a bug in ordinary code ends up being reported as a
 * dead network: the write is then parked in the queue instead of surfacing, and
 * it is retried on every reconnect, forever.
 */
export class OfflineError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OfflineError";
  }
}

/**
 * A write is only worth queueing when the network is what stopped it. A 4xx
 * means the server refused the row - a duplicate, a broken RLS policy, a bad
 * column - and repeating it on every reconnect would fail forever, so those are
 * raised to the caller instead of being parked.
 */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof OfflineError) return true;
  if (!(err instanceof Error)) return false;
  return /network|failed to fetch|fetch failed|load failed|offline|terminated/i.test(err.message);
}

/** A queued write carries one row; a bulk one carries a list. Both are read. */
const asRows = (payload: unknown): Record<string, unknown>[] =>
  (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];

/** Applies a queued write to a snapshot, returning a new one. */
export function applyOp(snapshot: Snapshot, op: PendingOp): Snapshot {
  const next: Snapshot = { ...snapshot, [op.table]: { ...(snapshot[op.table] ?? {}) } };
  const bag = next[op.table]!;

  switch (op.kind) {
    case "create":
    case "bulkCreate": {
      for (const row of asRows(op.payload)) {
        const id = idOf(row);
        if (id) bag[id] = row;
      }
      return next;
    }
    case "update":
    case "bulkUpdate": {
      for (const row of asRows(op.payload) as ({ id: Id } & Record<string, unknown>)[]) {
        const cur = bag[row.id];
        bag[row.id] = cur ? { ...cur, ...row } : row;
      }
      return next;
    }
    case "delete": {
      delete bag[op.payload as Id];
      return next;
    }
    case "deleteMany": {
      for (const row of rowsOf(snapshot, op.table)) {
        if (matches(row, op.where)) delete bag[idOf(row) as Id];
      }
      return next;
    }
  }
}

/**
 * Everything a queue holds, folded into the fewest operations that would still
 * produce the same result on the server.
 *
 * A row created and then deleted while offline never existed as far as the
 * server is concerned, so sending the insert first would resurrect a row the
 * user has already thrown away. Repeated updates to one row collapse into the
 * last one, and an update followed by a delete of the same row keeps only the
 * delete.
 */
export function coalesce(ops: PendingOp[]): PendingOp[] {
  const out: PendingOp[] = [];
  const index = new Map<string, number>();

  for (const op of ops) {
    // The slot a row occupies: every operation on one row shares it.
    const slot = rowSlot(op);

    const at = slot ? index.get(slot) : undefined;
    if (at === undefined) {
      if (slot) index.set(slot, out.length);
      out.push(op);
      continue;
    }

    const prev = out[at];
    // A create followed by a delete cancels out: neither needs to be sent.
    if (prev.kind === "create" && op.kind === "delete") {
      out.splice(at, 1);
      index.delete(slot!);
      for (const [k, v] of index) if (v > at) index.set(k, v - 1);
      continue;
    }
    // A delete then an update on the same row is a delete: the row is gone.
    if (prev.kind === "delete" && op.kind === "update") continue;
    // A create then an update is still one create carrying the newer values.
    if (prev.kind === "create" && op.kind === "update") {
      out[at] = {
        ...prev,
        payload: { ...(prev.payload as object), ...(op.payload as object) },
      };
      continue;
    }
    out[at] = op;
  }

  return out;
}

/**
 * The slot a row occupies, so every operation on the same row can find the one
 * before it. A single-row operation has a slot by its id; a bulk one touches
 * many rows and is left alone, since folding those together would mean working
 * out which of the rows they overlap.
 */
function rowSlot(op: PendingOp): string | null {
  if (op.kind === "create") {
    const id = idOf(op.payload);
    return id ? `${op.table}:${id}` : null;
  }
  if (op.kind === "delete") return `${op.table}:${op.payload as Id}`;
  if (op.kind === "update") {
    const id = (op.payload as { id?: Id }).id;
    return id ? `${op.table}:${id}` : null;
  }
  return null;
}

/**
 * Answers a read from a cached snapshot, applying the same filter, order and
 * limit the live query asked for. Without this an offline page would either
 * show nothing or show every row, whichever came first.
 */
export function selectFromSnapshot(
  snapshot: Snapshot,
  table: EntityName,
  where: Where | undefined,
  sort: string | string[] | undefined,
  limit: number | undefined,
): unknown[] {
  let out = rowsOf(snapshot, table);
  if (where) out = out.filter((r) => matches(r, where));
  out = applySort(out, sort);
  if (limit) out = out.slice(0, limit);
  return out;
}

/** True when the snapshot holds nothing for this table, so a fallback cannot lie. */
export const snapshotHas = (snapshot: Snapshot, table: EntityName) =>
  Object.keys(snapshot[table] ?? {}).length > 0;
