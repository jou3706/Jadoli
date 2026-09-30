/**
 * Browser stand-in for the tests. Import this first: ESM evaluates imports in
 * declaration order, so the globals exist before any app module is evaluated
 * (`store.ts` registers a window listener at module scope).
 */

/** The raw map behind the shim, for tests that need to inspect it. */
export const browserStorage = new Map<string, string>();

export const localStorageShim = {
  getItem: (k: string) => browserStorage.get(k) ?? null,
  setItem: (k: string, v: string) => void browserStorage.set(k, String(v)),
  removeItem: (k: string) => void browserStorage.delete(k),
  clear: () => browserStorage.clear(),
  key: (i: number) => [...browserStorage.keys()][i] ?? null,
  get length() {
    return browserStorage.size;
  },
};

const win = {
  localStorage: localStorageShim,
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

(globalThis as Record<string, unknown>).localStorage = localStorageShim;
(globalThis as Record<string, unknown>).window = win;

/** Wipes every table so each test starts from a clean database. */
export const clearStorage = () => browserStorage.clear();
