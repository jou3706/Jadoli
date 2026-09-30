import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOp,
  coalesce,
  emptySnapshot,
  isNetworkError,
  OfflineError,
  selectFromSnapshot,
  snapshotHas,
  type PendingOp,
  type Snapshot,
} from "../src/lib/db/offline.ts";
import { memoryStore, setOfflineStore } from "../src/lib/db/offline-store.ts";
import { SupabaseBackend } from "../src/lib/db/supabase.ts";

/* ── helpers ──────────────────────────────────────────────── */

const op = (over: Partial<PendingOp> = {}): PendingOp => ({
  id: over.id ?? "op1",
  kind: over.kind ?? "create",
  table: over.table ?? "Lecture",
  payload: over.payload ?? { id: "a", subject_name: "OS" },
  where: over.where,
  queuedAt: over.queuedAt ?? 1,
});

const snap = (rows: Record<string, unknown>[]): Snapshot => ({
  Lecture: Object.fromEntries(rows.map((r) => [(r as { id: string }).id, r])),
});

/* ── isNetworkError ───────────────────────────────────────── */

test("a dead network is the thing worth retrying", () => {
  assert.equal(isNetworkError(new TypeError("Failed to fetch")), true);
  assert.equal(isNetworkError(new Error("NetworkError when attempting to fetch")), true);
  assert.equal(isNetworkError(new Error("Load failed")), true);
});

test("a refusal from the server is not retried forever", () => {
  assert.equal(isNetworkError(new Error("Supabase 409: duplicate key")), false);
  assert.equal(isNetworkError(new Error("Supabase 401: JWT expired")), false);
  assert.equal(isNetworkError("nope"), false);
  assert.equal(isNetworkError(null), false);
});

/* ── applyOp ──────────────────────────────────────────────── */

test("a queued create shows up locally straight away", () => {
  const next = applyOp(emptySnapshot(), op({ payload: { id: "x", subject_name: "OS" } }));
  assert.equal(selectFromSnapshot(next, "Lecture", undefined, undefined, undefined).length, 1);
});

test("a queued update merges into the row rather than replacing it", () => {
  const next = applyOp(snap([{ id: "a", subject_name: "OS", code: "OS1", hall: "H1" }]), op({
    kind: "update",
    payload: { id: "a", hall: "H2" },
  }));
  const row = selectFromSnapshot(next, "Lecture", undefined, undefined, undefined)[0] as Record<string, unknown>;
  assert.equal(row.hall, "H2", "the new value is applied");
  assert.equal(row.code, "OS1", "fields not in the update are kept");
});

test("a queued delete removes the row locally", () => {
  const next = applyOp(snap([{ id: "a" }, { id: "b" }]), op({ kind: "delete", payload: "a" }));
  assert.deepEqual(
    selectFromSnapshot(next, "Lecture", undefined, undefined, undefined).map((r) => (r as { id: string }).id),
    ["b"],
  );
});

test("a queued deleteMany only removes what the filter matches", () => {
  const next = applyOp(
    snap([{ id: "a", day: 0 }, { id: "b", day: 2 }]),
    op({ kind: "deleteMany", payload: null, where: { day: 0 } }),
  );
  assert.deepEqual(
    selectFromSnapshot(next, "Lecture", undefined, undefined, undefined).map((r) => (r as { id: string }).id),
    ["b"],
  );
});

test("applyOp does not mutate the snapshot it was given", () => {
  const before = snap([{ id: "a", hall: "H1" }]);
  const copy = JSON.stringify(before);
  applyOp(before, op({ kind: "update", payload: { id: "a", hall: "H2" } }));
  assert.equal(JSON.stringify(before), copy, "the input snapshot is left alone");
});

/* ── coalesce ─────────────────────────────────────────────── */

test("a row created and deleted while offline is never sent", () => {
  const ops = coalesce([
    op({ id: "1", kind: "create", payload: { id: "a" } }),
    op({ id: "2", kind: "delete", payload: "a" }),
  ]);
  assert.equal(ops.length, 0, "neither operation needs to reach the server");
});

test("repeated updates to one row collapse into the last", () => {
  const ops = coalesce([
    op({ id: "1", kind: "update", payload: { id: "a", hall: "H1" } }),
    op({ id: "2", kind: "update", payload: { id: "a", hall: "H2" } }),
    op({ id: "3", kind: "update", payload: { id: "a", hall: "H3" } }),
  ]);
  assert.equal(ops.length, 1);
  assert.equal((ops[0].payload as { hall: string }).hall, "H3");
});

test("a create then an update is still one create, carrying the newer values", () => {
  const ops = coalesce([
    op({ id: "1", kind: "create", payload: { id: "a", hall: "H1" } }),
    op({ id: "2", kind: "update", payload: { id: "a", hall: "H2" } }),
  ]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, "create");
  assert.equal((ops[0].payload as { hall: string }).hall, "H2");
});

test("an update after a delete does not bring the row back", () => {
  const ops = coalesce([
    op({ id: "1", kind: "delete", payload: "a" }),
    op({ id: "2", kind: "update", payload: { id: "a", hall: "H2" } }),
  ]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, "delete", "the row is gone, not updated");
});

test("operations on different rows are all kept, in order", () => {
  const ops = coalesce([
    op({ id: "1", kind: "update", payload: { id: "a" } }),
    op({ id: "2", kind: "update", payload: { id: "b" } }),
    op({ id: "3", kind: "update", payload: { id: "a", hall: "H9" } }),
  ]);
  assert.equal(ops.length, 2, "the second write to row a replaced the first");
  assert.equal((ops[0].payload as { id: string }).id, "a");
  assert.equal((ops[1].payload as { id: string }).id, "b");
});

test("two creates claiming the same id collapse to one", async () => {
  const ops = coalesce([
    op({ id: "1", kind: "create", payload: { id: "a", subject_name: "first" } }),
    op({ id: "2", kind: "create", payload: { id: "a", subject_name: "second" } }),
  ]);
  assert.equal(ops.length, 1, "the server can only hold one row with that id");
  assert.equal((ops[0].payload as { subject_name: string }).subject_name, "second");
});

/* ── selectFromSnapshot ───────────────────────────────────── */

test("an offline read applies the same filter as the live one", () => {
  const s = snap([
    { id: "a", day: 0, subject_name: "OS" },
    { id: "b", day: 2, subject_name: "OS" },
  ]);
  const out = selectFromSnapshot(s, "Lecture", { day: 2 }, undefined, undefined);
  assert.deepEqual(out.map((r) => (r as { id: string }).id), ["b"]);
});

test("an offline read applies the requested order and limit", () => {
  const s = snap([
    { id: "a", subject_name: "Zeta" },
    { id: "b", subject_name: "Alpha" },
    { id: "c", subject_name: "Mid" },
  ]);
  const ordered = selectFromSnapshot(s, "Lecture", undefined, "subject_name", undefined);
  assert.deepEqual(
    ordered.map((r) => (r as { subject_name: string }).subject_name),
    ["Alpha", "Mid", "Zeta"],
  );
  assert.deepEqual(
    selectFromSnapshot(s, "Lecture", undefined, "-subject_name", 2).map(
      (r) => (r as { subject_name: string }).subject_name,
    ),
    ["Zeta", "Mid"],
  );
});

test("a table nothing was ever read for is reported as empty, not invented", () => {
  assert.equal(snapshotHas(emptySnapshot(), "Grade"), false);
  assert.equal(snapshotHas(snap([{ id: "a" }]), "Grade"), false);
  assert.equal(snapshotHas(snap([{ id: "a" }]), "Lecture"), true);
});

/* ── the backend, end to end ──────────────────────────────── */

/** Stands in for the network: can be switched off, and replies on demand. */
function fakeNet(reply?: (url: string, init?: RequestInit) => unknown) {
  const orig = globalThis.fetch;
  const state = {
    online: true,
    sent: [] as { method: string; url: string; body?: string }[],
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!state.online) throw new TypeError("Failed to fetch");
    // Recorded only once the request is under way: an attempt that never left
    // the device is not something the server was sent.
    state.sent.push({
      method: init?.method ?? "GET",
      url,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const body = reply ? reply(url, init) : [];
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return {
    state,
    goOffline: () => {
      state.online = false;
    },
    comeOnline: () => {
      state.online = true;
    },
    restore: () => {
      globalThis.fetch = orig;
    },
  };
}

test("a read with no network answers from the snapshot", async () => {
  setOfflineStore(memoryStore());
  const f = fakeNet(() => [{ id: "a", subject_name: "OS" }]);
  const b = new SupabaseBackend();
  try {
    await b.table("Lecture").list();
    assert.equal(b.offlineStatus().pending, 0);

    f.goOffline();
    const rows = await b.table("Lecture").list();
    assert.deepEqual(rows.map((r) => r.id), ["a"], "the cached row is what the user sees");
  } finally {
    f.restore();
    setOfflineStore(null);
  }
});

test("offline with nothing cached says so instead of showing an empty schedule", async () => {
  setOfflineStore(memoryStore());
  const f = fakeNet();
  const b = new SupabaseBackend();
  try {
    f.goOffline();
    await assert.rejects(() => b.table("Lecture").list(), /offline/i);
  } finally {
    f.restore();
    setOfflineStore(null);
  }
});

test("a write made offline is queued, shown locally, and sent on reconnect", async () => {
  setOfflineStore(memoryStore());
  const f = fakeNet();
  const b = new SupabaseBackend();
  try {
    f.goOffline();
    await b.table("Lecture").create({ subject_name: "OS" } as never);
    assert.equal(b.offlineStatus().pending, 1, "the write is waiting, not lost");

    // Visible in the app without a network.
    const local = await b.table("Lecture").list();
    assert.equal(local.length, 1);
    assert.equal(local[0].subject_name, "OS");

    f.comeOnline();
    await b.sync();

    assert.equal(b.offlineStatus().pending, 0, "the queue drained");
    const posted = f.state.sent.filter((r) => r.method === "POST");
    assert.equal(posted.length, 1, "exactly one insert went out");
  } finally {
    f.restore();
    setOfflineStore(null);
  }
});

test("a queued row keeps the id it was given on the device", async () => {
  setOfflineStore(memoryStore());
  const f = fakeNet();
  const b = new SupabaseBackend();
  try {
    f.goOffline();
    const made = await b.table("Lecture").create({ subject_name: "OS" } as never);
    f.comeOnline();
    await b.sync();
    const posted = f.state.sent.find((r) => r.method === "POST");
    const sent = JSON.parse(posted?.body ?? "{}") as { id?: string };
    assert.equal(sent.id, made?.id, "the server is given the id the app already used");
  } finally {
    f.restore();
    setOfflineStore(null);
  }
});

test("two accounts never see or send each other's offline data", async () => {
  setOfflineStore(memoryStore());
  const f = fakeNet(() => [{ id: "a1", subject_name: "A" }]);
  const b = new SupabaseBackend();
  try {
    b.attachUser("user-a");
    await b.table("Lecture").list();

    f.goOffline();
    await b.table("Lecture").create({ subject_name: "from A" } as never);

    // A different account signs in on the same device.
    b.attachUser("user-b");
    await b.sync();
    await assert.rejects(
      () => b.table("Lecture").list(),
      /offline/i,
      "user B has nothing cached of their own, and must not be shown A's rows",
    );
    assert.equal(b.offlineStatus().pending, 0, "B does not inherit A's queue");

    // Back to A: their row and their queue are still theirs.
    b.attachUser("user-a");
    await b.sync();
    assert.equal(b.offlineStatus().pending, 1);
    const rows = await b.table("Lecture").list();
    assert.ok(
      rows.some((r) => r.subject_name === "from A"),
      "A's own unsaved row is still there",
    );
  } finally {
    f.restore();
    setOfflineStore(null);
  }
});

test("a row the server refuses is dropped instead of blocking the queue forever", async () => {
  setOfflineStore(memoryStore());
  const f = fakeNet();
  const b = new SupabaseBackend();
  try {
    f.goOffline();
    await b.table("Lecture").create({ subject_name: "first" } as never);
    await b.table("Lecture").create({ subject_name: "second" } as never);
    assert.equal(b.offlineStatus().pending, 2);

    f.comeOnline();
    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return new Response("conflict", { status: 409 });
      return new Response("[]", { status: 200 });
    }) as typeof fetch;

    await b.sync();
    assert.equal(b.offlineStatus().pending, 0, "the refused rows are not retried on every reconnect");
    assert.equal(
      b.rejectedOps().length,
      2,
      "and they are reported rather than dropped silently",
    );
  } finally {
    f.restore();
    setOfflineStore(null);
  }
});

test("a 4xx during an online write is raised, not queued", async () => {
  setOfflineStore(memoryStore());
  const f = fakeNet();
  const b = new SupabaseBackend();
  try {
    globalThis.fetch = (async () => new Response("nope", { status: 403 })) as typeof fetch;
    await assert.rejects(() => b.table("Lecture").create({ subject_name: "x" } as never), /403/);
    assert.equal(b.offlineStatus().pending, 0, "a refusal is the caller's problem, not a queued write");
  } finally {
    f.restore();
    setOfflineStore(null);
  }
});

test("a bug in our own code is not mistaken for a dead network", () => {
  // The distinction that matters: only a request that never got an answer is
  // "offline". A TypeError thrown by ordinary code - reading a property of
  // undefined, say - is a bug, and treating it as a dead network would park
  // the write in the queue and retry it on every reconnect, never explaining
  // itself.
  assert.equal(
    isNetworkError(new TypeError("Cannot read properties of undefined (reading 'id')")),
    false,
  );
  assert.equal(isNetworkError(new OfflineError("offline: no answer")), true);
});

test("a TypeError from the network itself still counts as offline", () => {
  // fetch() has no dedicated error class, so the text is what is left.
  assert.equal(isNetworkError(new TypeError("Failed to fetch")), true);
  assert.equal(isNetworkError(new TypeError("fetch failed")), true);
});
