import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { vapidKeys } from "@/lib/push-server";
import { subscriptionSchema } from "@/lib/push";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Saving and dropping a browser's push subscription.
 *
 * The browser is the only party that knows the endpoint, so it has to come from
 * there, and the only party that knows who is asking is the token it already has
 * - so this is written with the caller's own credentials rather than the service
 * role. That choice is what keeps RLS doing the work: `push_subscriptions_own`
 * decides what this route can touch, so there is no per-user `where` clause here
 * to get wrong.
 *
 * The zone travels with the subscription for the reason spelled out in
 * `lib/tz`: an event is a date and an hour with no zone on it, and the only
 * moment anyone knows whose clock those hours are on is the moment the browser
 * hands over its subscription.
 */

const TABLE = "push_subscriptions";

const bodySchema = z.object({
  subscription: subscriptionSchema,
});

/** A client bound to the caller's own token, so RLS applies exactly as on upload. */
function clientFor(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const bearer = (req: Request) =>
  (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

export async function GET() {
  // The public key is not a secret, but it is only half of a pair whose other
  // half lives on the server, and serving it from here keeps the two from being
  // set in different places and drifting.
  const keys = vapidKeys();
  if (!keys) {
    return NextResponse.json(
      { error: "Push is not configured on this deployment" },
      { status: 503 },
    );
  }
  return NextResponse.json({ vapidPublicKey: keys.publicKey });
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const sb = clientFor(bearer(req));
  if (!sb) {
    return NextResponse.json({ error: "Backend not configured" }, { status: 503 });
  }

  const { data: userData, error: userError } = await sb.auth.getUser(bearer(req));
  const userId = userData?.user?.id;
  if (userError || !userId) {
    return NextResponse.json({ error: "Sign in again" }, { status: 401 });
  }

  const { subscription } = parsed.data;
  const row = {
    user_id: userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    language: subscription.language,
    time_zone: subscription.timeZone,
  };

  const { error } = await sb.from(TABLE).upsert(row, { onConflict: "user_id,endpoint" });
  if (error) {
    return NextResponse.json({ error: `Could not save the subscription: ${error.message}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  let endpoint: unknown;
  try {
    const body = (await req.json()) as { endpoint?: unknown };
    endpoint = body?.endpoint;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof endpoint !== "string" || !endpoint) {
    return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  }

  const sb = clientFor(bearer(req));
  if (!sb) {
    return NextResponse.json({ error: "Backend not configured" }, { status: 503 });
  }

  const { data: userData, error: userError } = await sb.auth.getUser(bearer(req));
  if (userError || !userData?.user?.id) {
    return NextResponse.json({ error: "Sign in again" }, { status: 401 });
  }

  // Scoped by the caller's id as well as RLS: the policy already prevents this,
  // and the redundant filter means the intent survives a policy that is later
  // loosened by someone debugging something else.
  const { error } = await sb.from(TABLE).delete().eq("endpoint", endpoint).eq("user_id", userData.user.id);
  if (error) {
    return NextResponse.json({ error: `Could not remove the subscription: ${error.message}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}