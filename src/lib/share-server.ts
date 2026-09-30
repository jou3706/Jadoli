import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Lecture, UniversityEvent } from "@/lib/db/types";
import type { SharePayload } from "@/lib/share-types";

/**
 * Share links. Two stores, picked at runtime:
 *
 *  - Supabase `share_links` when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
 *    set. Required for serverless/multi-process, where the local filesystem is
 *    not shared between instances.
 *  - A JSON file under `.data/shares/`, which is enough for a single
 *    self-hosted instance and needs no configuration.
 */

const DIR = path.join(process.cwd(), ".data", "shares");
const MAX_AGE_MS = 100 * 24 * 60 * 60 * 1000;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const MAX_LINKS = 500;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** The service key is server-only and bypasses RLS, which anonymous shares need. */
const remoteEnabled = () => Boolean(SUPABASE_URL && SERVICE_KEY);

const token = () =>
  Array.from(crypto.randomBytes(10))
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join("");

/** A stored share: the payload plus the key it lives under. */
type ShareRecord = SharePayload & { token: string };

/* ── Supabase store ─────────────────────────────────────────── */

async function remote(
  method: "GET" | "POST" | "DELETE",
  query: Record<string, string>,
  body?: unknown,
) {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/share_links?${qs}`, {
    method,
    headers: {
      apikey: SERVICE_KEY as string,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`share_links ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json().catch(() => []);
}

async function createShareRemote(payload: ShareRecord) {
  // Opportunistic cleanup keeps the table from growing without bound.
  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();
  await remote("DELETE", { created_at: `lt.${cutoff}` }).catch(() => {});
  await remote("POST", { select: "token" }, [
    {
      token: payload.token,
      owner_name: payload.owner_name,
      payload: { lectures: payload.lectures, events: payload.events },
      created_at: new Date(payload.created).toISOString(),
    },
  ]);
}

async function getShareRemote(t: string): Promise<SharePayload | null> {
  const rows = (await remote("GET", {
    select: "payload,created_at",
    token: `eq.${t}`,
    limit: "1",
  })) as { payload: Omit<SharePayload, "created">; created_at: string }[];
  const row = rows[0];
  if (!row) return null;
  const created = Date.parse(row.created_at);
  if (Date.now() - created > MAX_AGE_MS) return null;
  return { ...row.payload, created };
}

/* ── File store ────────────────────────────────────────────── */

async function readStore(): Promise<Record<string, SharePayload>> {
  try {
    const raw = await fs.readFile(path.join(DIR, "index.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeStore(store: Record<string, SharePayload>) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(
    path.join(DIR, "index.json"),
    JSON.stringify(store),
    "utf8",
  );
}

async function createShareLocal(payload: ShareRecord) {
  const store = await readStore();
  const now = Date.now();

  // Drop anything expired, then cap total links so the file can't grow forever.
  for (const [k, v] of Object.entries(store)) {
    if (now - v.created > MAX_AGE_MS) delete store[k];
  }
  const keys = Object.keys(store);
  if (keys.length > MAX_LINKS) {
    keys
      .sort((a, b) => store[a].created - store[b].created)
      .slice(0, keys.length - (MAX_LINKS - 1))
      .forEach((k) => delete store[k]);
  }

  store[payload.token] = payload;
  await writeStore(store);
}

async function getShareLocal(t: string): Promise<SharePayload | null> {
  const store = await readStore();
  const found = store[t];
  if (!found) return null;
  if (Date.now() - found.created > MAX_AGE_MS) return null;
  return found;
}

/* ── Public surface ────────────────────────────────────────── */

export async function createShare(input: {
  owner_name?: string;
  lectures: Lecture[];
  events?: UniversityEvent[];
}) {
  const payload: ShareRecord = {
    token: token(),
    owner_name: (input.owner_name ?? "").trim() || "Jadoli",
    lectures: input.lectures ?? [],
    events: input.events ?? [],
    created: Date.now(),
  };

  if (remoteEnabled()) await createShareRemote(payload);
  else await createShareLocal(payload);

  return payload.token;
}

export async function getShare(t: string): Promise<SharePayload | null> {
  if (remoteEnabled()) return getShareRemote(t);
  return getShareLocal(t);
}
