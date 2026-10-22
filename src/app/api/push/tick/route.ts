import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { deliverTo, serviceClient, type StoredSubscription } from "@/lib/push-server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The student's own delivery pass.
 *
 * The reminder job lives in the database and runs every minute. That is the
 * right place for it, because it has to fire whether or not anybody has the
 * app open - but it needs a scheduled job to exist, and a scheduled job is
 * installed by running a migration in the SQL editor. Until that is done, the
 * reminders of a student who has the app open in front of them would still not
 * arrive, which is the one case where they can see that they are missing.
 *
 * So the app asks for its own reminders: this route signs in the caller, works
 * out what that one reader owes, and pushes it to that one reader's browsers.
 * It cannot send anyone else's reminders, because the list it sends to is
 * filtered by the id that came out of the token rather than by anything the
 * caller can put in the request. The database job is still the thing that
 * covers a phone with the app closed; this is the thing that covers the app
 * being open, and it costs one request a minute.
 *
 * It deliberately writes no heartbeat. The heartbeat belongs to the scheduled
 * job, and a browser writing it would turn a dead job into a healthy-looking
 * one - which is the exact lie this whole arrangement exists to avoid.
 */

const bearer = (req: Request) =>
  (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

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

export async function POST(req: Request) {
  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ error: "Sign in again" }, { status: 401 });
  }

  const own = clientFor(token);
  if (!own) {
    return NextResponse.json({ error: "Backend not configured" }, { status: 503 });
  }

  const { data: userData, error: userError } = await own.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId) {
    return NextResponse.json({ error: "Sign in again" }, { status: 401 });
  }

  let sb: ReturnType<typeof serviceClient>;
  try {
    sb = serviceClient();
  } catch {
    return NextResponse.json({ error: "Backend not configured" }, { status: 503 });
  }

  // Only this student's subscriptions, by the id the token proved.
  const { data: subs, error } = await sb
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth,language,time_zone")
    .eq("user_id", userId);
  if (error) {
    return NextResponse.json({ error: `Could not read subscriptions: ${error.message}` }, { status: 502 });
  }

  try {
    const summary = await deliverTo(sb, (subs ?? []) as unknown as StoredSubscription[]);
    return NextResponse.json(summary);
  } catch (e) {
    const message = (e as Error).message;
    if (message === "NO_VAPID") {
      return NextResponse.json(
        { error: "VAPID keys are not set on this deployment" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
