import { NextResponse } from "next/server";
import { deliveryConfig, lastTick, serviceClient, vapidKeys } from "@/lib/push-server";

export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * Is the reminder delivery actually running?
 *
 * Every part of this can be true while the reminders still do not arrive, and
 * that combination is exactly what was mistaken for "there are no reminders
 * this week": the deployment has its keys, the database has its secrets, the
 * phone is subscribed, and nothing ever gets sent. The one thing that answers
 * the question is the job's own heartbeat - the row it writes every minute -
 * so that is what this reports.
 *
 * Nothing here identifies anybody. The secret itself is never printed: only
 * whether one is set.
 */
export async function GET() {
  const keys = vapidKeys();

  let sb: ReturnType<typeof serviceClient>;
  try {
    sb = serviceClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: "The database is not configured on this deployment" },
      { status: 503 },
    );
  }

  const body: Record<string, unknown> = {
    ok: false,
    /** Whether this deployment can sign a push at all. */
    vapid: Boolean(keys),
  };

  try {
    const config = await deliveryConfig(sb);
    body.apiUrl = config.apiUrl;
    body.apiUrlSet = config.apiUrlSet;
    body.cronSecretSet = config.cronSecretSet;

    const tick = await lastTick(sb);
    if (tick) {
      const at = new Date(tick.at).getTime();
      body.lastTick = tick;
      body.minutesSinceTick = Number.isFinite(at)
        ? Math.round((Date.now() - at) / 60_000)
        : null;
      // A job that runs every minute and has not been heard from in three
      // minutes is not running. Three, not two: a tick can be a minute late
      // without anything being wrong.
      body.jobAlive = Number.isFinite(at) && Date.now() - at < 3 * 60_000;
    } else {
      body.lastTick = null;
      body.minutesSinceTick = null;
      // Never a tick. The job has not run once, which is different from a job
      // that ran and had nothing to send.
      body.jobAlive = false;
    }
  } catch (e) {
    // A missing table is the likeliest reason: the heartbeat is written by a
    // newer version of the schema than the one that has been applied.
    body.error = (e as Error).message;
    body.jobAlive = false;
  }

  try {
    const { count } = await sb
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true });
    body.subscriptions = count ?? 0;
  } catch {
    body.subscriptions = null;
  }

  body.ok = body.jobAlive === true && body.vapid === true;

  return NextResponse.json(body);
}
