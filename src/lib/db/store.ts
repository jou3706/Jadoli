"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LocalBackend,
  isSupabaseConfigured,
  type Backend,
  type TableApi,
  type Where,
} from "./local";
import { SupabaseBackend } from "./supabase";
import { CHANGE_EVENT, notifyDataChanged } from "./events";
import type { EntityMap, EntityName, Id } from "./types";

/* ── Backend selection ────────────────────────────────────── */

let backend: Backend | null = null;

export function getBackend(): Backend {
  if (backend) return backend;
  backend = isSupabaseConfigured()
    ? new SupabaseBackend()
    : new LocalBackend();
  return backend;
}

export const DB_NAME = () => getBackend().name;

/** base44-shaped convenience surface: `db.entities.Lecture.list()` */
export const db = {
  get entities() {
    const b = getBackend();
    return new Proxy({} as Record<EntityName, TableApi<EntityName>>, {
      get: (_t, name: string) =>
        (b.table as (n: EntityName) => TableApi<EntityName>)(name as EntityName),
    });
  },
};

/* ── Change notification ───────────────────────────────────── */

const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener(CHANGE_EVENT, () => {
    // A write just landed (or another tab wrote to localStorage): drop the
    // stale cache, then let every mounted query re-read.
    backend?.refresh();
    listeners.forEach((l) => l());
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Run a query and re-run it whenever local data changes. Drop `deps` to
 * re-query on every data change, pass them to scope the re-fetch.
 */
export function useQuery<T>(
  run: () => Promise<T>,
  deps: unknown[] = [],
): { data: T | undefined; isLoading: boolean; error: Error | null } {
  const [data, setData] = useState<T>();
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => subscribe(() => setNonce((n) => n + 1)), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    run()
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, isLoading, error };
}

export const useList = <E extends EntityName>(
  name: E,
  sort?: string | string[],
  limit?: number,
  deps: unknown[] = [],
) =>
  useQuery(() => getBackend().table(name).list(sort, limit), deps);

export const useFilter = <E extends EntityName>(
  name: E,
  where: Where,
  sort?: string | string[],
  limit?: number,
  deps: unknown[] = [],
) =>
  useQuery(
    () => getBackend().table(name).filter(where, sort, limit),
    [JSON.stringify(where), ...deps],
  );

/* ── Mutations ─────────────────────────────────────────────── */

export function useMutate<E extends EntityName>(name: E) {
  return useMemo(() => {
    const t = () => getBackend().table(name);
    return {
      create: (data: Partial<EntityMap[E]>) => t().create(data),
      update: (id: Id, data: Partial<EntityMap[E]>) => t().update(id, data),
      remove: (id: Id) => t().delete(id),
      bulkCreate: (rows: Partial<EntityMap[E]>[]) => t().bulkCreate(rows),
      bulkUpdate: (rows: ({ id: Id } & Partial<EntityMap[E]>)[]) =>
        t().bulkUpdate(rows),
      deleteMany: (where: Where, opts?: { all?: boolean }) =>
        t().deleteMany(where, opts),
    };
  }, [name]);
}

/* ── Cross-tab sync ───────────────────────────────────────── */

export function useCrossTabSync() {
  const reload = useCallback(() => {
    notifyDataChanged();
  }, []);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith("jadoli_v1:")) reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [reload]);
}
