import { notifyDataChanged } from "./events";
import { ENTITY_NAMES, type EntityMap, type EntityName, type Id } from "./types";

const NS = "jadoli_v1";
const dataKey = (e: EntityName) => `${NS}:${e}`;
const versionKey = `${NS}:schema`;

/** Bump to force every client to re-seed and drop incompatible local data. */
const SCHEMA_VERSION = 1;

type DB = { [E in EntityName]: Record<Id, EntityMap[E]> };

const empty = (): DB =>
  Object.fromEntries(
    ENTITY_NAMES.map((n) => [n, {}]),
  ) as DB;

function read(): DB {
  if (typeof window === "undefined") return empty();
  try {
    if (localStorage.getItem(versionKey) !== String(SCHEMA_VERSION)) {
      const fresh = empty();
      write(fresh);
      localStorage.setItem(versionKey, String(SCHEMA_VERSION));
      return fresh;
    }
    const raw = localStorage.getItem(dataKey("Lecture"));
    if (!raw) return empty();
    const db = empty();
    for (const n of ENTITY_NAMES) {
      const chunk = localStorage.getItem(dataKey(n));
      (db as Record<string, unknown>)[n] = chunk ? JSON.parse(chunk) : {};
    }
    return db;
  } catch {
    return empty();
  }
}

function write(db: DB) {
  if (typeof window === "undefined") return;
  try {
    for (const n of ENTITY_NAMES) {
      localStorage.setItem(dataKey(n), JSON.stringify(db[n]));
    }
  } catch {
    /* quota exceeded — ignore */
  }
}

/* ── Sorting ──────────────────────────────────────────────── */

export function getField(row: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[k];
    return undefined;
  }, row);
}

/**
 * Sort spec: `"-created_date"` descending, `"created_date"` ascending,
 * `"field,desc"` for an explicit direction, or an array for several keys,
 * e.g. `["subject_name", "-day"]`.
 *
 * Exported because the offline reader has to order a cached snapshot with the
 * same rules PostgREST would have used for it.
 */
export function applySort<T>(rows: T[], sort?: string | string[]): T[] {
  if (!sort) return rows;
  const specs = (Array.isArray(sort) ? sort : [sort]).map((s) => {
    const desc = s.startsWith("-");
    const field = desc ? s.slice(1) : s;
    const [f, dir] = field.split(",");
    return { field: f, desc: dir === "desc" ? true : desc };
  });
  return [...rows].sort((a, b) => {
    for (const { field, desc } of specs) {
      const av = getField(a, field);
      const bv = getField(b, field);
      if (av === bv) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return desc ? -cmp : cmp;
    }
    return 0;
  });
}

export type Where = Record<string, unknown>;

/**
 * Exported for the offline reader: a cached snapshot is filtered with the same
 * rules a live `filter()` would have sent to PostgREST.
 */
export function matches(row: unknown, where?: Where): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    const actual = getField(row, k);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const cond = v as Record<string, unknown>;
      if ("$gte" in cond) {
        return actual != null && String(actual) >= String(cond.$gte);
      }
      if ("$lte" in cond) {
        return actual != null && String(actual) <= String(cond.$lte);
      }
      if ("$ne" in cond) return actual !== cond.$ne;
      if ("$in" in cond) return (cond.$in as unknown[]).includes(actual);
      return false;
    }
    if (Array.isArray(v)) return v.includes(actual);
    return actual === v;
  });
}

/* ── Backend adapter contract ─────────────────────────────── */

export type TableApi<E extends EntityName> = {
  list(sort?: string | string[], limit?: number): Promise<EntityMap[E][]>;
  filter(where: Where, sort?: string | string[], limit?: number): Promise<EntityMap[E][]>;
  create(data: Partial<EntityMap[E]>): Promise<EntityMap[E]>;
  update(id: Id, data: Partial<EntityMap[E]>): Promise<EntityMap[E]>;
  delete(id: Id): Promise<void>;
  bulkCreate(rows: Partial<EntityMap[E]>[]): Promise<EntityMap[E][]>;
  bulkUpdate(
    rows: ({ id: Id } & Partial<EntityMap[E]>)[],
  ): Promise<EntityMap[E][]>;
  /**
   * `where: {}` matches every row, so it only runs when the caller passes
   * `{ all: true }` — see the import flow, which is the one place that means it.
   */
  deleteMany(where: Where, opts?: { all?: boolean }): Promise<void>;
};

/**
 * A storage backend. `LocalBackend` keeps everything in localStorage so the app
 * works with zero setup. `SupabaseBackend` mirrors the same surface and is
 * swapped in when the Supabase env vars are present.
 */
export interface Backend {
  name: "local" | "supabase";
  table<E extends EntityName>(name: E): TableApi<E>;
  /** Drops any in-memory cache so the next read hits the source of truth. */
  refresh(): void;
  /** Supabase only: the caller's access token, used for RLS. */
  attachSession?(accessToken: string | null): void;
  /** Supabase only: the caller's user id, written as the row owner. */
  attachUser?(userId: string | null): void;
  /**
   * Supabase only: connection state and the size of the unsent write queue, so
   * the UI can say whether the app is looking at live data.
   */
  subscribeOffline?(cb: () => void): () => void;
  offlineStatus?(): { online: boolean; pending: number };
  /** Supabase only: sends everything the queue is holding. */
  sync?(): Promise<void>;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export class LocalBackend implements Backend {
  name = "local" as const;
  private cache: DB;

  constructor() {
    this.cache = read();
  }

  refresh() {
    this.cache = read();
  }

  private commit() {
    write(this.cache);
    notifyDataChanged();
  }

  private rows<E extends EntityName>(name: E): EntityMap[E][] {
    return Object.values(this.cache[name]) as EntityMap[E][];
  }

  table<E extends EntityName>(name: E): TableApi<E> {
    return {
      list: async (sort, limit) => {
        let out = applySort(this.rows(name), sort);
        if (limit) out = out.slice(0, limit);
        return structuredClone(out);
      },
      filter: async (where, sort, limit) => {
        let out = applySort(
          this.rows(name).filter((r) => matches(r, where)),
          sort,
        );
        if (limit) out = out.slice(0, limit);
        return structuredClone(out);
      },
      create: async (data) => {
        const now = new Date().toISOString();
        const row = {
          ...(data as object),
          id: newId(),
          created_date: now,
          updated_date: now,
        } as EntityMap[E];
        (this.cache[name] as Record<Id, EntityMap[E]>)[row.id] = row;
        this.commit();
        return structuredClone(row);
      },
      update: async (id, data) => {
        const cur = (this.cache[name] as Record<Id, EntityMap[E]>)[id];
        if (!cur) throw new Error(`${name} ${id} not found`);
        const next = {
          ...cur,
          ...data,
          id,
          updated_date: new Date().toISOString(),
        } as EntityMap[E];
        (this.cache[name] as Record<Id, EntityMap[E]>)[id] = next;
        this.commit();
        return structuredClone(next);
      },
      delete: async (id) => {
        delete (this.cache[name] as Record<Id, EntityMap[E]>)[id];
        this.commit();
      },
      bulkCreate: async (rows) => {
        const now = new Date().toISOString();
        const out = rows.map((data) => {
          const row = {
            ...(data as object),
            id: newId(),
            created_date: now,
            updated_date: now,
          } as EntityMap[E];
          (this.cache[name] as Record<Id, EntityMap[E]>)[row.id] = row;
          return row;
        });
        this.commit();
        return structuredClone(out);
      },
      bulkUpdate: async (rows) => {
        const out = rows.map(({ id, ...data }) => {
          const cur = (this.cache[name] as Record<Id, EntityMap[E]>)[id];
          if (!cur) return cur;
          const next = {
            ...cur,
            ...data,
            id,
            updated_date: new Date().toISOString(),
          } as EntityMap[E];
          (this.cache[name] as Record<Id, EntityMap[E]>)[id] = next;
          return next;
        });
        this.commit();
        return structuredClone(out.filter(Boolean)) as EntityMap[E][];
      },
      deleteMany: async (where, opts) => {
        if (!where || Object.keys(where).length === 0) {
          if (!opts?.all) {
            throw new Error(
              `${name}.deleteMany: refusing to delete every row without { all: true }`,
            );
          }
          (this.cache as Record<string, unknown>)[name] = {};
          this.commit();
          return;
        }
        const bag = this.cache[name] as Record<Id, EntityMap[E]>;
        for (const [id, row] of Object.entries(bag)) {
          if (matches(row, where)) delete bag[id];
        }
        this.commit();
      },
    };
  }
}

export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
