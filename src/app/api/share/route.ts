import { NextResponse } from "next/server";
import { z } from "zod";
import { createShare } from "@/lib/share-server";

export const runtime = "nodejs";

const lecture = z.object({
  id: z.string(),
  subject_name: z.string().default(""),
  subject_en: z.string().default(""),
  code: z.string().default(""),
  doctor: z.string().default(""),
  hall: z.string().default(""),
  day: z.number().min(0).max(6),
  start_time: z.string(),
  end_time: z.string(),
  kind: z.enum(["lecture", "section"]).default("lecture"),
  color: z.string().default("indigo"),
  notes: z.string().default(""),
  department: z.string().default(""),
  created_date: z.string().default(""),
});

const event = z.object({
  id: z.string(),
  title: z.string(),
  title_en: z.string().default(""),
  date: z.string(),
  type: z.enum(["holiday", "announcement", "exam", "event"]).default("event"),
  note: z.string().default(""),
});

const bodySchema = z.object({
  owner_name: z.string().max(80).optional(),
  // At least one lecture: an empty link shows nobody anything, and accepting
  // it would let anyone fill the store with useless tokens.
  lectures: z.array(lecture).min(1).max(500),
  events: z.array(event).max(200).default([]),
});

/* ── Per-IP throttle ─────────────────────────────────────────
 * Sharing is deliberately unauthenticated (a first-time visitor makes a link
 * before signing up), so nothing stops a script from filling the store. The
 * limit below is a door-bumper, not a hard budget: a sliding minute window per
 * address, enough for real use and quick to outgrow for an automated one. Held
 * in memory because a serverless instance only needs to catch the calls that
 * land on it — the point is to make abuse cost work, not to count perfectly. */

const SHARE_WINDOW_MS = 60_000;
const SHARE_MAX_PER_WINDOW = 15;
const hits = new Map<string, number[]>();

function allowedToCreate(address: string): boolean {
  const now = Date.now();
  const fresh = (hits.get(address) ?? []).filter((t) => now - t < SHARE_WINDOW_MS);
  if (fresh.length >= SHARE_MAX_PER_WINDOW) {
    hits.set(address, fresh);
    return false;
  }
  fresh.push(now);
  hits.set(address, fresh);
  // The map only grows by one bucket per burst; prune it before it can leak.
  if (hits.size > 5000) {
    for (const [k, arr] of hits) {
      const alive = arr.filter((t) => now - t < SHARE_WINDOW_MS);
      if (alive.length) hits.set(k, alive);
      else hits.delete(k);
    }
  }
  return true;
}

/** Replaces the base44 `CreateShareLink` server function. */
export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (!allowedToCreate(ip)) {
    return NextResponse.json(
      { error: "Too many share links from this address — try again in a minute" },
      { status: 429, headers: { "retry-after": String(SHARE_WINDOW_MS / 1000) } },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 },
    );
  }
  const t = await createShare(parsed.data);
  return NextResponse.json({ token: t });
}
