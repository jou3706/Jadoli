import { test } from "node:test";
import assert from "node:assert/strict";
import { SupabaseBackend } from "../src/lib/db/supabase.ts";

/** Records every request and replies with whatever `reply` returns. */
function fakeFetch(reply: (url: string) => unknown) {
  const urls: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return new Response(JSON.stringify(reply(url)), { status: 200 });
  }) as typeof fetch;
  return {
    urls,
    get hits() {
      return urls.length;
    },
    restore: () => {
      globalThis.fetch = orig;
    },
  };
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

test("Supabase read cache: identical list() hits the network once", async () => {
  const f = fakeFetch(() => rows(3));
  const b = new SupabaseBackend();
  try {
    const a = await b.table("Grade").list("-id");
    const c = await b.table("Grade").list("-id");
    assert.equal(f.hits, 1, "second identical read should be served from cache");
    assert.deepEqual(a, c);
  } finally {
    f.restore();
  }
});

test("Supabase read cache: different sort/limit is a different cache key", async () => {
  const f = fakeFetch(() => rows(2));
  const b = new SupabaseBackend();
  try {
    await b.table("Grade").list("-id");
    await b.table("Grade").list("id");
    assert.equal(f.hits, 2);
  } finally {
    f.restore();
  }
});

test("Supabase read cache: a write drops the cache", async () => {
  const f = fakeFetch(() => rows(1));
  const b = new SupabaseBackend();
  try {
    await b.table("Material").list();
    assert.equal(f.hits, 1);

    await b.table("Material").create({ title: "x", url: "https://a.test" });
    await b.table("Material").list();
    assert.equal(f.hits, 3, "after a write the next read must go to the network");
  } finally {
    f.restore();
  }
});

test("Supabase read cache: refresh() (cross-tab) drops the cache", async () => {
  const f = fakeFetch(() => rows(1));
  const b = new SupabaseBackend();
  try {
    await b.table("Lecture").list();
    b.refresh();
    await b.table("Lecture").list();
    assert.equal(f.hits, 2);
  } finally {
    f.restore();
  }
});

test("Supabase read cache: a cross-tab refresh on one table drops them all", async () => {
  const f = fakeFetch(() => rows(1));
  const b = new SupabaseBackend();
  try {
    await b.table("Grade").list();
    await b.table("Material").list();
    b.refresh();
    await b.table("Grade").list();
    await b.table("Material").list();
    assert.equal(f.hits, 4);
  } finally {
    f.restore();
  }
});
