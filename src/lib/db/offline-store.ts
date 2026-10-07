/**
 * Durable storage for the offline snapshot and outbox.
 *
 * IndexedDB is the target: the snapshot holds whole tables and the outbox can
 * hold extracted file text, which overflows the localStorage quota. Two
 * fallbacks keep the app working rather than crashing when IndexedDB is
 * unavailable - private browsing in some browsers, and the server render,
 * where there is no `window` at all.
 *
 * Storage is injectable so tests can supply an in-memory implementation
 * instead of standing up IndexedDB in Node.
 */

export interface OfflineStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
}

export function memoryStore(seed?: Record<string, unknown>): OfflineStore {
  const map = new Map<string, unknown>(Object.entries(seed ?? {}));
  return {
    async get<T>(key: string) {
      return map.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      map.set(key, value);
    },
    async del(key: string) {
      map.delete(key);
    },
  };
}

const DB_NAME = "jadwali_offline";
const STORE = "kv";
const DB_VERSION = 1;

function idbStore(): OfflineStore | null {
  if (typeof indexedDB === "undefined") return null;
  let db: IDBDatabase | null = null;

  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => {
        db = req.result;
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    });

  const run = <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> =>
    open().then(
      (d) =>
        new Promise<T>((resolve, reject) => {
          const tx = d.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
        }),
    );

  return {
    async get<T>(key: string) {
      return (await run<T | undefined>("readonly", (s) => s.get(key))) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      await run("readwrite", (s) => s.put(value, key));
    },
    async del(key: string) {
      await run("readwrite", (s) => s.delete(key));
    },
  };
}

function localStorageStore(): OfflineStore | null {
  if (typeof localStorage === "undefined") return null;
  return {
    async get<T>(key: string) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? undefined : (JSON.parse(raw) as T);
      } catch {
        return undefined;
      }
    },
    async set<T>(key: string, value: T) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* quota exceeded: the in-memory copy still serves this session */
      }
    },
    async del(key: string) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

let store: OfflineStore | null = null;

/** Replaces the storage used by the offline layer. Tests pass a memory store. */
export function setOfflineStore(next: OfflineStore | null) {
  store = next;
}

export function getOfflineStore(): OfflineStore {
  if (store) return store;
  store =
    idbStore() ??
    localStorageStore() ??
    // The server render and any browser without either API: keep the data for
    // the life of the process rather than throwing on the first read.
    memoryStore();
  return store;
}

export const snapshotKey = (owner: string) => `jadwali:offline:snapshot:${owner}`;
export const outboxKey = (owner: string) => `jadwali:offline:outbox:${owner}`;
