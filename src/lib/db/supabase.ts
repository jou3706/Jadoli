import type { Backend, TableApi, Where } from "./local";
import { notifyDataChanged } from "./events";
import {
  applyOp,
  coalesce,
  emptySnapshot,
  isRetryableLater,
  AuthExpiredError,
  OfflineError,
  selectFromSnapshot,
  snapshotHas,
  type PendingOp,
  type Snapshot,
} from "./offline";
import { getOfflineStore, outboxKey, snapshotKey } from "./offline-store";
import type { EntityMap, EntityName, Id } from "./types";

/**
 * Supabase/PostgREST backend. Activated automatically when
 * NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.
 *
 * Tables are snake_case and follow the column map below. Run
 * `supabase/schema.sql` to create them.
 */
const TABLES: Record<EntityName, string> = {
  Lecture: "lectures",
  Attendance: "attendance",
  Grade: "grades",
  Material: "materials",
Subject: "subjects",
  SubjectEvent: "subject_events",
  UniversityEvent: "university_events",
  Flashcard: "flashcards",
  ReviewSession: "review_sessions",
  Question: "questions",
  Chat: "chats",
  Message: "messages",
};

/** camelCase field -> snake_case column. Only overrides needed. */
const COLS: Partial<Record<EntityName, Record<string, string>>> = {
  Lecture: {
    subject_name: "subject_name",
    subject_en: "subject_en",
    start_time: "start_time",
    end_time: "end_time",
  },
  UniversityEvent: { title_en: "title_en" },
  // No overrides needed for flashcards or review sessions: every field is
  // already snake_case, so `toCol`'s default is the right column.
  Chat: { sort_order: "sort_order" },
  Message: { chat_id: "chat_id", file_text: "file_text" },
  Attendance: { lecture_id: "lecture_id", week_start: "week_start" },
};

const toCol = (name: EntityName, field: string) =>
  COLS[name]?.[field] ?? field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const toRow = <E extends EntityName>(
  name: EntityName,
  raw: object,
): EntityMap[E] => {
  const out: Record<string, unknown> = {};
  // PostgREST returns no row when `return=representation` matches nothing -
  // an update aimed at a row that is already gone, for instance. Reading
  // `Object.entries` of that would throw a TypeError for what is a normal
  // answer, and a TypeError that looks like a dead network gets a write parked
  // in the queue instead of reported.
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) out[k] = v;
  }
  return out as EntityMap[E];
};

export class SupabaseBackend implements Backend {
  name = "supabase" as const;
  private base: string;
  private key: string;
  private token: string | null = null;
  private userId: string | null = null;

  constructor() {
    this.base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
    this.key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
    if (typeof window !== "undefined") {
      // Coming back online is the moment the queue is worth sending. The write
      // itself still fails harmlessly if the network is not really there.
      window.addEventListener("online", () => {
        void this.sync();
        this.emit();
      });
      window.addEventListener("offline", () => this.emit());
    }
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      apikey: this.key,
      // RLS reads auth.uid() from this JWT, so it must be the user's token.
      Authorization: `Bearer ${this.token ?? this.key}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  private url(name: EntityName, query: Record<string, string>) {
    const qs = new URLSearchParams(query).toString();
    return `${this.base}/${TABLES[name]}?${qs}`;
  }

  /**
   * The cache namespace. The signed-in user decides which rows PostgREST is
   * allowed to return, so the cache is scoped by it — otherwise signing out
   * and into another account in the same tab would serve the first account's
   * rows to the second one. Keyed on the user id rather than the token so a
   * token refresh is not mistaken for a different account.
   */
  private cacheOwner: string | null = null;

  private updateScope() {
    if (this.userId === this.cacheOwner) return;
    this.cacheOwner = this.userId;
    // A different identity means every cached row belongs to somebody else.
    this.bump();
    // Anything already on screen was read as the previous account.
    notifyDataChanged();
  }

  attachSession(accessToken: string | null) {
    this.token = accessToken;
  }

  /** Called by the auth provider once a Supabase session exists. */
  attachUser(userId: string | null) {
    this.userId = userId;
    // Both the snapshot and the queue are namespaced by account, so signing in
    // as somebody else has to re-read them. Carrying the previous account's
    // rows in memory would show one person's schedule to the next, and sending
    // their queued writes under the new account would write them to the wrong
    // owner.
    this.snapLoadedFor = null;
    this.outboxLoadedFor = null;
    this.snap = emptySnapshot();
    this.outbox = [];
    this.rejected = [];
    this.updateScope();
    void this.sync();
  }

  private async req<T>(
    name: EntityName,
    init: RequestInit & { query?: Record<string, string> } = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.url(name, init.query ?? {}), {
        ...init,
        headers: this.headers(init.headers as Record<string, string>),
      });
    } catch (err) {
      // The request never got an answer. Marked here, at the only place that
      // knows the difference between "the network is gone" and "something in
      // our own code threw".
      throw new OfflineError(
        `offline: ${name} could not reach the server`,
        { cause: err },
      );
    }
      if (!res.ok) {
      const text = await res.text().catch(() => "");
      const message = `Supabase ${res.status}: ${text.slice(0, 200)}`;
      // A rejected token is not a refusal of the row. It is a token that has
      // gone stale, which a refresh fixes as soon as there is a network, so it
      // is carried as its own kind of "not now" rather than as an error the app
      // would have to show over the user's own cached data.
      if (res.status === 401) throw new AuthExpiredError(message);
      throw new Error(message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private sortQuery(name: EntityName, sort?: string | string[]) {
    if (!sort) return undefined;
    const specs = (Array.isArray(sort) ? sort : [sort]).map((s) => {
      const desc = s.startsWith("-");
      const field = toCol(name, desc ? s.slice(1) : s);
      return desc ? `${field}.desc` : `${field}.asc`;
    });
    return specs.join(",");
  }

  /**
   * Turns a `where` object into PostgREST query params.
   *
   * This returns params and not a query string on purpose: the string used to
   * be re-parsed by every caller, and because PostgREST spells a filter
   * `col.eq.value` while the params need `col=eq.value`, every filtered read
   * and every filtered delete went out as `col.eq.value=` and silently matched
   * nothing.
   */
  private whereParams(name: EntityName, where?: Where): Record<string, string> {
    if (!where) return {};
    const conds: string[] = [];
    for (const [k, v] of Object.entries(where)) {
      const col = toCol(name, k);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const cond = v as Record<string, unknown>;
        if ("$gte" in cond) conds.push(`${col}.gte.${cond.$gte}`);
        if ("$lte" in cond) conds.push(`${col}.lte.${cond.$lte}`);
        if ("$ne" in cond) conds.push(`${col}.neq.${cond.$ne}`);
        if ("$in" in cond) conds.push(`${col}.in.(${cond.$in as unknown[]})`);
      } else if (Array.isArray(v)) {
        conds.push(`${col}.in.(${v})`);
      } else {
        conds.push(`${col}.eq.${v}`);
      }
    }
    if (conds.length === 0) return {};
    // One condition is a plain param; several have to be combined, because a
    // column can only carry one operator in the query string.
    if (conds.length === 1) {
      const [col, ...rest] = conds[0].split(".");
      return { [col]: rest.join(".") };
    }
    return { and: `(${conds.join(",")})` };
  }

  private body(name: EntityName, data: object, insert = false) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      out[toCol(name, k)] = v;
    }
    // Every table is user-scoped; RLS rejects inserts without the owner id.
    if (insert) out.user_id = this.userId ?? null;
    return out;
  }

  refresh() {
    /* Cross-tab writes fire the change event; drop the cache with it. */
    this.bump();
  }

  /**
   * Read cache. Every page mounts its own `useList`, so walking between two
   * pages re-asked the network for rows it had just fetched — and PostgREST is
   * ~200ms away from here. Reads are cached per table and dropped on any write,
   * so the data is never stale.
   */
  private cache = new Map<string, { at: number; rows: unknown[] }>();

  private bump() {
    this.cache.clear();
  }

  /**
   * Called after a write has landed, never before: clearing the cache first
   * would let a read that happens *during* the write cache the old rows and
   * hand them back to the re-fetch.
   */
  private invalidate() {
    this.bump();
    notifyDataChanged();
  }

  /* ── Offline ──────────────────────────────────────────────── */

  /**
   * The rows last read from the server, kept per account so a read with no
   * network still answers with real data. Held in memory as well as on disk
   * because a page walk asks for the same tables over and over.
   */
  private snap: Snapshot = emptySnapshot();
  private snapLoadedFor: string | null = null;

  private outbox: PendingOp[] = [];
  private outboxLoadedFor: string | null = null;

  private listeners = new Set<() => void>();
  private syncPromise: Promise<void> | null = null;

  /** Notifies the UI that the connection or the queue changed. */
  subscribeOffline(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  offlineStatus() {
    return {
      online: typeof navigator === "undefined" ? true : navigator.onLine,
      pending: this.outbox.length,
    };
  }

  private emit() {
    for (const cb of this.listeners) cb();
  }

  private ownerKey(): string {
    return this.userId ?? "anon";
  }

  private async snapshot(): Promise<Snapshot> {
    const owner = this.ownerKey();
    if (this.snapLoadedFor === owner) return this.snap;
    this.snap = (await getOfflineStore().get<Snapshot>(snapshotKey(owner))) ?? emptySnapshot();
    this.snapLoadedFor = owner;
    return this.snap;
  }

  private async outboxFor(): Promise<PendingOp[]> {
    const owner = this.ownerKey();
    if (this.outboxLoadedFor === owner) return this.outbox;
    this.outbox = (await getOfflineStore().get<PendingOp[]>(outboxKey(owner))) ?? [];
    this.outboxLoadedFor = owner;
    return this.outbox;
  }

  private async saveSnapshot() {
    await getOfflineStore().set(snapshotKey(this.ownerKey()), this.snap);
  }

  private async saveOutbox() {
    await getOfflineStore().set(outboxKey(this.ownerKey()), this.outbox);
  }

  /** Folds freshly read rows into the cached copy. */
  private async mergeSnapshot(name: EntityName, rows: Record<string, unknown>[]) {
    const snap = await this.snapshot();
    const bag = { ...(snap[name] ?? {}) };
    for (const row of rows) {
      const id = row.id;
      if (typeof id === "string") bag[id] = row;
    }
    this.snap = { ...snap, [name]: bag };
    await this.saveSnapshot();
  }

  /**
   * Parks a write that could not reach the server, and shows it locally right
   * away so the app behaves as if it had been saved. It is replayed by
   * `sync()` once the network is back.
   */
  private async enqueue(op: Omit<PendingOp, "id" | "queuedAt">): Promise<void> {
    const full: PendingOp = {
      ...op,
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      queuedAt: Date.now(),
    };
    const current = await this.outboxFor();
    // Applying before coalescing means a create+delete pair folds away
    // completely, leaving nothing to send and nothing to show.
    const withOp = applyOp(await this.snapshot(), full);
    this.snap = withOp;
    await this.saveSnapshot();
    this.outbox = coalesce([...current, full]);
    await this.saveOutbox();
    this.invalidate();
    this.emit();
  }

  /**
   * Sends everything the queue is holding, oldest first, and stops at the
   * first failure: later operations may depend on it, and replaying them out
   * of order would write rows the server has not seen yet.
   */
  async sync(): Promise<void> {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.runSync().finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }

  private async runSync() {
    const queued = await this.outboxFor();
    if (queued.length === 0) {
      // Still tell the UI: reaching this point is what loads the queue, and a
      // badge that only updates when there is something to send would sit at
      // zero until the first write.
      this.emit();
      return;
    }
    const pending = [...queued];
    for (const op of pending) {
      try {
        await this.perform(op);
        this.outbox = this.outbox.filter((o) => o.id !== op.id);
        await this.saveOutbox();
      } catch (err) {
        // Still no network, or the token is stale: leave the whole queue alone
        // and try later. Dropping these would lose the user's work - a queued
        // write is the only copy until it is accepted.
        if (isRetryableLater(err)) break;
        // The server refused this one. Keeping it would retry forever, and it
        // is holding up everything queued behind it, so it is dropped and the
        // rest gets its chance.
        this.outbox = this.outbox.filter((o) => o.id !== op.id);
        await this.saveOutbox();
        this.rejected.push(op);
      }
    }
    if (this.outbox.length !== pending.length) {
      this.bump();
      notifyDataChanged();
    }
    this.emit();
  }

  /** Operations the server refused; surfaced so they are not lost silently. */
  private rejected: PendingOp[] = [];

  rejectedOps() {
    return this.rejected;
  }

  /**
   * Carries out one queued operation against the server. Client-generated ids
   * are sent as-is, so a row created offline keeps the same id once it lands
   * and nothing in the app has to be renumbered.
   */
  private perform(op: PendingOp): Promise<unknown> {
    const api = this.table(op.table);
    switch (op.kind) {
      case "create":
        return api.create(op.payload as Partial<EntityMap[typeof op.table]>);
      case "bulkCreate":
        return api.bulkCreate(op.payload as Partial<EntityMap[typeof op.table]>[]);
      case "update":
        return api.update(
          (op.payload as { id: Id }).id,
          op.payload as Partial<EntityMap[typeof op.table]>,
        );
      case "bulkUpdate":
        return api.bulkUpdate(op.payload as ({ id: Id } & object)[]);
      case "delete":
        return api.delete(op.payload as Id);
      case "deleteMany":
        return api.deleteMany(op.where ?? {});
    }
  }

  /**
   * Runs a write, falling back to the queue when the network is what stopped
   * it. A refusal from the server is raised rather than parked, so a bad row
   * is reported to the person who typed it instead of failing silently later.
   *
   * `offlineResult` is what the caller gets back when the write is queued
   * instead of sent. It matters: a create that returned nothing would leave the
   * caller - the attendance sheet, the import - holding an undefined row it
   * has just been told was saved.
   */
  private async write(
    kind: PendingOp["kind"],
    table: EntityName,
    payload: unknown,
    send: () => Promise<unknown>,
    opts: { where?: Where; offlineResult?: unknown } = {},
  ): Promise<unknown> {
    try {
      const out = await send();
      this.invalidate();
      return out;
    } catch (err) {
      if (!isRetryableLater(err)) throw err;
      await this.enqueue({ kind, table, payload, where: opts.where });
      return opts.offlineResult;
    }
  }

  private async read<E extends EntityName>(
    name: E,
    q: { where?: Where; sort?: string | string[]; limit?: number } = {},
  ): Promise<EntityMap[E][]> {
    // The key carries the identity, so a row read as one account can never be
    // handed to another even if a cache drop is missed.
    const owner = this.userId;
    const key = `${owner ?? "anon"}|${name}|${JSON.stringify(q.where ?? null)}|${JSON.stringify(q.sort ?? null)}|${q.limit ?? ""}`;
    const hit = this.cache.get(key);
    if (hit) return hit.rows as EntityMap[E][];

    let rows: EntityMap[E][];
    try {
      const raw = await this.req<Record<string, unknown>[]>(name, {
        query: this.listQuery(name, q.where, q.sort, q.limit),
      });
      // The account changed while this was in flight, so the answer belongs to
      // somebody who is no longer signed in: read it again as the current one.
      if (owner !== this.userId) return this.read<E>(name, q);
      rows = raw.map((r) => toRow<E>(name, r));
      // A live answer is the newest thing known about these rows, so it
      // replaces what the snapshot holds. Doing this on the way through is
      // also what makes a later offline read correct. Awaited so two reads
      // racing cannot write the snapshot out of order.
      await this.mergeSnapshot(name, rows);
    } catch (err) {
      // A dead network or a stale token falls back. A real refusal is the
      // server answering about the row itself, and answering that with cached
      // rows would hide a genuine problem.
      if (!isRetryableLater(err)) throw err;
      const snap = await this.snapshot();
      if (!snapshotHas(snap, name)) {
        throw new Error(
          `${name}: offline and nothing cached for this account yet — reconnect once to be able to use it without a network`,
        );
      }
      rows = selectFromSnapshot(snap, name, q.where, q.sort, q.limit) as EntityMap[E][];
    }

    this.cache.set(key, { at: Date.now(), rows });
    return rows;
  }

  private listQuery(
    name: EntityName,
    where?: Where,
    sort?: string | string[],
    limit?: number,
  ): Record<string, string> {
    const order = this.sortQuery(name, sort);
    return {
      select: "*",
      ...this.whereParams(name, where),
      ...(order ? { order } : {}),
      ...(limit ? { limit: String(limit) } : {}),
    };
  }

  table<E extends EntityName>(name: E): TableApi<E> {
    const sel = "*";
    return {
      list: (sort, limit) => this.read<E>(name, { sort, limit }),

      filter: (where, sort, limit) => this.read<E>(name, { where, sort, limit }),

      /**
       * A row created offline is given its id here, on the client, and that
       * same id is sent when the queue is replayed. If the server were left to
       * choose one, every id in the app - attendance records, the countdown,
       * the row the user just created - would have to be renumbered when the
       * write finally landed.
       */
      create: async (data) => {
        const id =
          (data as { id?: Id }).id ??
          (typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
        const now = new Date().toISOString();
        const row = {
          ...(data as object),
          id,
          created_date: (data as { created_date?: string }).created_date ?? now,
          updated_date: now,
        } as unknown as Partial<EntityMap[E]>;
        return (await this.write("create", name, row, async () => {
          const rows = await this.req<Record<string, unknown>[]>(name, {
            method: "POST",
            headers: { Prefer: "return=representation" },
            query: { select: sel },
            body: JSON.stringify(this.body(name, row as object, true)),
          });
          // No representation back is not a failure; what was sent is the
          // best answer available, and it carries the id the app already used.
          return rows[0] ? toRow<E>(name, rows[0]) : (row as EntityMap[E]);
        }, { offlineResult: row as EntityMap[E] })) as EntityMap[E];
      },

      update: async (id, data) => {
        const payload = { ...(data as object), id } as Partial<EntityMap[E]>;
        return (await this.write(
          "update",
          name,
          payload,
          async () => {
            const rows = await this.req<Record<string, unknown>[]>(name, {
              method: "PATCH",
              headers: { Prefer: "return=representation" },
              query: { select: sel, id: `eq.${id}` },
              body: JSON.stringify(this.body(name, data as object)),
            });
            return rows[0] ? toRow<E>(name, rows[0]) : (payload as EntityMap[E]);
          },
          { offlineResult: payload as EntityMap[E] },
        )) as EntityMap[E];
      },

      delete: async (id) => {
        await this.write("delete", name, id, async () => {
          await this.req<void>(name, { method: "DELETE", query: { id: `eq.${id}` } });
        });
      },

      bulkCreate: async (rows) => {
        const prepared = rows.map((r) => {
          const now = new Date().toISOString();
          return {
            ...(r as object),
            id:
              (r as { id?: Id }).id ??
              (typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`),
            created_date: (r as { created_date?: string }).created_date ?? now,
            updated_date: now,
          } as unknown as Partial<EntityMap[E]>;
        });
        return (await this.write(
          "bulkCreate",
          name,
          prepared,
          async () => {
            const out = await this.req<Record<string, unknown>[]>(name, {
              method: "POST",
              headers: { Prefer: "return=representation" },
              query: { select: sel },
              body: JSON.stringify(prepared.map((r) => this.body(name, r as object, true))),
            });
            return out.map((r) => toRow<E>(name, r));
          },
          { offlineResult: prepared as EntityMap[E][] },
        )) as EntityMap[E][];
      },

      bulkUpdate: async (rows) => {
        return (await this.write(
          "bulkUpdate",
          name,
          rows,
          async () => {
            const out: Record<string, unknown>[] = [];
            for (const r of rows) {
              const { id, ...rest } = r as { id: Id } & object;
              const res = await this.req<Record<string, unknown>[]>(name, {
                method: "PATCH",
                headers: { Prefer: "return=representation" },
                query: { select: sel, id: `eq.${id}` },
                body: JSON.stringify(this.body(name, rest)),
              });
              if (res[0]) out.push(res[0]);
            }
            return out.map((r) => toRow<E>(name, r));
          },
          { offlineResult: rows as EntityMap[E][] },
        )) as EntityMap[E][];
      },

      /**
       * Bulk delete. `where: {}` is a full-table delete, so it has to be asked
       * for explicitly — a silent `DELETE` with no filter is how a schedule
       * disappears. When it is asked for, the owner is still pinned in the
       * query so it can never reach another user's rows.
       */
      deleteMany: async (where, opts) => {
        const cond = this.whereParams(name, where);
        const empty = Object.keys(cond).length === 0;
        if (empty && !opts?.all) {
          throw new Error(
            `${name}.deleteMany: refusing to delete every row without { all: true }`,
          );
        }
        if (empty && !this.userId) {
          throw new Error(`${name}.deleteMany: no signed-in user, refusing to delete`);
        }
        // The owner is written into the queued filter, not read at replay time:
        // a full-table delete replayed after signing in as somebody else would
        // otherwise empty that account instead of this one.
        const pinned = empty ? { user_id: this.userId } : where;
        await this.write(
          "deleteMany",
          name,
          pinned,
          async () => {
            await this.req<void>(name, {
              method: "DELETE",
              query: empty ? { user_id: `eq.${this.userId}` } : cond,
            });
          },
          { where: pinned },
        );
      },
    };
  }
}
