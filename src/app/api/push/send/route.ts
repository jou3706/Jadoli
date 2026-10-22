import { NextResponse } from "next/server";
import {
  deliverTo,
  recordTick,
  secretMatches,
  serviceClient,
  type StoredSubscription,
} from "@/lib/push-server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The minute-accurate sender, called by `supabase/09-push-subscriptions.sql`.
 *
 * Deliberately not a route a browser can usefully call: it is guarded by the
 * shared secret in a header, because the caller is a database job that cannot
 * hold a session. Nothing here is idempotent per browser, so an open route would
 * be a way to send every subscriber's reminders at once, repeatedly, to anyone
 * who found it.
 *
 * The shape of a run: for each subscription, work out what that reader owes from
 * their own zone, send it, and write down what went out. Subscriptions the push
 * service reports as gone are deleted in the same pass, because a row that can
 * never be delivered to is a row that costs a lookup every minute forever.
 *
 * The work itself is in `deliverTo`, because the same rules have to hold for
 * the student's own browser - which delivers to that one student, and to nobody
 * else - when the database job is not there to do it.
 */
export async function POST(req: Request) {
  if (!secretMatches(req.headers.get("x-cron-secret"), process.env.PUSH_CRON_SECRET)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  let sb: ReturnType<typeof serviceClient>;
  try {
    sb = serviceClient();
  } catch {
    return NextResponse.json({ error: "Backend not configured" }, { status: 503 });
  }

  const { data: subs, error } = await sb
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth,language,time_zone")
    .limit(1000);
  if (error) {
    return NextResponse.json({ error: `Could not read subscriptions: ${error.message}` }, { status: 502 });
  }

  let summary;
  try {
    summary = await deliverTo(sb, (subs ?? []) as unknown as StoredSubscription[]);
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

  // The heartbeat, written whether or not anything was sent.
  //
  // This run is the proof that the job is alive: a minute of silence in this
  // table means the job stopped, and a job that has stopped delivers nothing
  // without saying so. The failure is not allowed to hide the run, so the tick
  // is written even when a delivery went wrong.
  try {
    await recordTick(sb, summary);
  } catch {
    /* a heartbeat that cannot be written must not cost the reminders */
  }

  return NextResponse.json(summary);
}
