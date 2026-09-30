import { test } from "node:test";
import assert from "node:assert/strict";
import { SupabaseBackend } from "../src/lib/db/supabase.ts";

/**
 * A write has to reach the screen on its own. These cover the two bugs that
 * made the app look broken: nothing re-read after a write (so a delete or an
 * add only appeared after a manual refresh), and a `deleteMany({})` that sent
 * an unfiltered DELETE and could empty the whole table.
 */

type Call = { url: string; method: string; token: string; body?: string };

function recorder(
  reply: (url: string, token: string) => unknown = () => [],
) {
  const calls: Call[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const token = String(headers.Authorization ?? "").replace("Bearer ", "");
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      token,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(JSON.stringify(reply(String(input), token)), { status: 200 });
  }) as typeof fetch;
  return {
    calls,
    get last() {
      return calls[calls.length - 1];
    },
    restore: () => {
      globalThis.fetch = orig;
    },
  };
}

/** A window stand-in: node has no DOM, and the backends only dispatch events. */
function fakeWindow() {
  const g = globalThis as { window?: unknown };
  const prev = g.window;
  const seen: string[] = [];
  g.window = {
    addEventListener: () => {},
    dispatchEvent: (e: { type: string }) => {
      seen.push(e.type);
      return true;
    },
  };
  return {
    events: seen,
    restore: () => {
      if (prev === undefined) delete g.window;
      else g.window = prev;
    },
  };
}

test("every write tells the app to re-read, so no manual refresh is needed", async () => {
  const w = fakeWindow();
  const f = recorder(() => [{ id: 1 }]);
  const b = new SupabaseBackend();
  try {
    await b.table("Material").create({ title: "a", url: "https://a.test" });
    await b.table("Material").update("row-1", { title: "b" });
    await b.table("Material").delete("row-1");
    await b.table("Material").bulkCreate([{ title: "c" }]);
    await b.table("Material").deleteMany({ title: "c" });
    assert.equal(
      w.events.filter((e: string) => e === "jadoli:db").length,
      5,
      "each write must fire exactly one change event",
    );
  } finally {
    f.restore();
    w.restore();
  }
});

test("the change event only fires after the write, never before", async () => {
  const w = fakeWindow();
  const order: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => {
    order.push("network");
    return new Response(JSON.stringify([{ id: 1 }]), { status: 200 });
  }) as typeof fetch;
  const b = new SupabaseBackend();
  try {
    await b.table("Material").delete("row-1");
    assert.deepEqual(
      order,
      ["network"],
      "the write has to reach the database before the cache is dropped",
    );
  } finally {
    globalThis.fetch = orig;
    w.restore();
  }
});

test("a failed write does not claim the screen is up to date", async () => {
  const w = fakeWindow();
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
  const b = new SupabaseBackend();
  try {
    await assert.rejects(() => b.table("Material").delete("row-1"));
    assert.equal(
      w.events.length,
      0,
      "nothing changed, so no list should be told to re-read",
    );
  } finally {
    globalThis.fetch = orig;
    w.restore();
  }
});

test("deleteMany({}) is refused instead of emptying the table", async () => {
  const w = fakeWindow();
  const f = recorder(() => []);
  const b = new SupabaseBackend();
  b.attachUser("11111111-1111-1111-1111-111111111111");
  try {
    await assert.rejects(
      () => b.table("Lecture").deleteMany({}),
      /all: true/,
      "an unfiltered delete must be asked for explicitly",
    );
    assert.equal(f.calls.length, 0, "nothing may be sent to the database");
  } finally {
    f.restore();
    w.restore();
  }
});

test("deleteMany({ all: true }) still pins the owner in the query", async () => {
  const w = fakeWindow();
  const f = recorder(() => []);
  const b = new SupabaseBackend();
  b.attachUser("11111111-1111-1111-1111-111111111111");
  try {
    await b.table("Lecture").deleteMany({}, { all: true });
    assert.equal(f.last.method, "DELETE");
    assert.match(
      f.last.url,
      /user_id=eq\.11111111-1111-1111-1111-111111111111/,
      "a full delete must stay scoped to the signed-in user",
    );
  } finally {
    f.restore();
    w.restore();
  }
});

test("one account can never read another account's rows", async () => {
  const w = fakeWindow();
  // Stands in for RLS: the server only ever replies with the caller's rows.
  const f = recorder((_url, token) =>
    token === "alice-token" ? [{ id: 1, title: "alice private notes" }] : [],
  );
  const b = new SupabaseBackend();
  try {
    b.attachSession("alice-token");
    b.attachUser("alice-uid");
    const asAlice = await b.table("Material").list();
    assert.equal(asAlice.length, 1);
    assert.equal(asAlice[0].title, "alice private notes");

    // Same tab, no reload: alice signs out and bob signs in.
    b.attachSession(null);
    b.attachUser(null);
    b.attachSession("bob-token");
    b.attachUser("bob-uid");

    const asBob = await b.table("Material").list();
    assert.equal(
      asBob.length,
      0,
      "bob must not be handed alice's rows out of the cache",
    );
    assert.equal(f.calls.length, 2, "bob's read has to go to the server");
    assert.equal(f.last.token, "bob-token");
  } finally {
    f.restore();
    w.restore();
  }
});

test("a read that lands after a sign-out is not cached for the next account", async () => {
  const w = fakeWindow();
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    // alice's slow response: the account changes while it is in flight.
    if (calls === 1) {
      b.attachSession(null);
      b.attachUser(null);
      b.attachSession("bob-token");
      b.attachUser("bob-uid");
    }
    return new Response(JSON.stringify([{ id: calls, title: `row-${calls}` }]), {
      status: 200,
    });
  }) as typeof fetch;
  const b = new SupabaseBackend();
  b.attachSession("alice-token");
  b.attachUser("alice-uid");
  try {
    const rows = await b.table("Material").list();
    assert.equal(calls, 2, "the stale answer has to be re-read as the new account");
    assert.equal(rows[0].title, "row-2");
  } finally {
    globalThis.fetch = orig;
    w.restore();
  }
});

test("switching accounts tells the mounted lists to re-read", async () => {
  const w = fakeWindow();
  const b = new SupabaseBackend();
  try {
    b.attachSession("alice-token");
    b.attachUser("alice-uid");
    const afterFirst = w.events.length;
    b.attachSession("alice-token");
    b.attachUser("alice-uid");
    assert.equal(w.events.length, afterFirst, "the same account is not a change");

    b.attachSession("bob-token");
    b.attachUser("bob-uid");
    assert.equal(
      w.events.length,
      afterFirst + 1,
      "a new account must invalidate what is on screen",
    );
  } finally {
    w.restore();
  }
});

test("a filter reaches PostgREST as col=eq.value, not col.eq.value", async () => {
  const w = fakeWindow();
  const f = recorder(() => []);
  const b = new SupabaseBackend();
  try {
    await b.table("Message").filter({ chat_id: "abc" });
    assert.match(
      f.last.url,
      /chat_id=eq\.abc/,
      "the dotted form is a valid PostgREST value, not a param name",
    );
    assert.doesNotMatch(f.last.url, /chat_id\.eq\.abc/);
  } finally {
    f.restore();
    w.restore();
  }
});

test("two conditions on one column are combined instead of overwriting", async () => {
  const w = fakeWindow();
  const f = recorder(() => []);
  const b = new SupabaseBackend();
  try {
    await b.table("Lecture").filter({ created_date: { $gte: "a", $lte: "b" } });
    const url = decodeURIComponent(f.last.url);
    assert.match(url, /and=\(/);
    assert.match(url, /created_date\.gte\.a/);
    assert.match(url, /created_date\.lte\.b/);
  } finally {
    f.restore();
    w.restore();
  }
});

test("deleteMany with a real filter keeps the filter and needs no opt-in", async () => {
  const w = fakeWindow();
  const f = recorder(() => []);
  const b = new SupabaseBackend();
  try {
    await b.table("Message").deleteMany({ chat_id: "abc" });
    assert.equal(f.last.method, "DELETE");
    assert.match(f.last.url, /chat_id=eq\.abc/);
    assert.doesNotMatch(f.last.url, /user_id=/);
  } finally {
    f.restore();
    w.restore();
  }
});
