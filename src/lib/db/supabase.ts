import type { Backend, TableApi, Where } from "./local";
import { notifyDataChanged } from "./events";
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
  Hall: "halls",
  Material: "materials",
  Subject: "subjects",
  UniversityEvent: "university_events",
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
  for (const [k, v] of Object.entries(raw)) out[k] = v;
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
    this.updateScope();
  }

  private async req<T>(
    name: EntityName,
    init: RequestInit & { query?: Record<string, string> } = {},
  ): Promise<T> {
    const res = await fetch(this.url(name, init.query ?? {}), {
      ...init,
      headers: this.headers(init.headers as Record<string, string>),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
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

  private async read<E extends EntityName>(
    name: E,
    query: Record<string, string>,
  ): Promise<EntityMap[E][]> {
    // The key carries the identity, so a row read as one account can never be
    // handed to another even if a cache drop is missed.
    const owner = this.userId;
    const key = `${owner ?? "anon"}|${name}?${new URLSearchParams(query).toString()}`;
    const hit = this.cache.get(key);
    if (hit) return hit.rows as EntityMap[E][];

    const rows = await this.req<Record<string, unknown>[]>(name, { query });
    // The account changed while this was in flight, so the answer belongs to
    // somebody who is no longer signed in: read it again as the current one.
    if (owner !== this.userId) return this.read<E>(name, query);
    const mapped = rows.map((r) => toRow<E>(name, r));
    this.cache.set(key, { at: Date.now(), rows: mapped });
    return mapped;
  }

  table<E extends EntityName>(name: E): TableApi<E> {
    const sel = "*";
    return {
      list: (sort, limit) =>
        this.read<E>(name, {
          select: sel,
          ...(this.sortQuery(name, sort) ? { order: this.sortQuery(name, sort)! } : {}),
          ...(limit ? { limit: String(limit) } : {}),
        }),

      filter: (where, sort, limit) =>
        this.read<E>(name, {
          select: sel,
          ...this.whereParams(name, where),
          ...(this.sortQuery(name, sort) ? { order: this.sortQuery(name, sort)! } : {}),
          ...(limit ? { limit: String(limit) } : {}),
        }),

      create: async (data) => {
        const rows = await this.req<Record<string, unknown>[]>(name, {
          method: "POST",
          headers: { Prefer: "return=representation" },
          query: { select: sel },
          body: JSON.stringify(this.body(name, data as object, true)),
        });
        this.invalidate();
        return toRow<E>(name, rows[0]);
      },

      update: async (id, data) => {
        const rows = await this.req<Record<string, unknown>[]>(name, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          query: { select: sel, id: `eq.${id}` },
          body: JSON.stringify(this.body(name, data as object)),
        });
        this.invalidate();
        return toRow<E>(name, rows[0]);
      },

      delete: async (id) => {
        await this.req<void>(name, {
          method: "DELETE",
          query: { id: `eq.${id}` },
        });
        this.invalidate();
      },

      bulkCreate: async (rows) => {
        const out = await this.req<Record<string, unknown>[]>(name, {
          method: "POST",
          headers: { Prefer: "return=representation" },
          query: { select: sel },
          body: JSON.stringify(rows.map((r) => this.body(name, r as object, true))),
        });
        this.invalidate();
        return out.map((r) => toRow<E>(name, r));
      },

      bulkUpdate: async (rows) => {
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
        this.invalidate();
        return out.map((r) => toRow<E>(name, r));
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
        await this.req<void>(name, {
          method: "DELETE",
          query: empty ? { user_id: `eq.${this.userId}` } : cond,
        });
        this.invalidate();
      },
    };
  }
}
