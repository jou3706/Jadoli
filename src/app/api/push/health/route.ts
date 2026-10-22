import { NextResponse } from "next/server";
import { deliveryConfig, serviceClient, tickStatus, vapidKeys } from "@/lib/push-server";

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
 *
 * The check is also allowed to say what is missing, because "the job is not
 * running" on its own is a symptom: the job cannot run until the migration
 * that creates its table and its schedule has been applied, and a person
 * reading this in a browser needs to be told which file to run.
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
    /**
     * Which shape the secrets table is in. "secret" means the database is
     * running the schema from before the migration, which is the difference
     * between "the job is broken" and "the job has not been installed yet".
     */
    body.secretsShape = config.shape;

    const ticks = await tickStatus(sb);
    body.ticksTable = ticks.table;

    if (ticks.last) {
      const at = new Date(ticks.last.at).getTime();
      body.lastTick = ticks.last;
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

  /**
   * What the person reading this should do, in one sentence.
   *
   * The answer is only ever about the deployment: a migration that has not been
   * applied, a secret that was never set, or a job that has stopped. It never
   * prints a secret and it never names a student.
   */
  if (body.jobAlive !== true) {
    if (body.ticksTable === false || body.secretsShape === "secret") {
      body.hint =
        "The database migration has not been applied. Run supabase/09-push-subscriptions.sql in the Supabase SQL editor, then open this page again.";
    } else if (body.cronSecretSet !== true) {
      body.hint =
        "The delivery secret is missing. Set push_cron_secret in the database and the same value as PUSH_CRON_SECRET on Vercel.";
    } else if (body.apiUrlSet !== true) {
      body.hint = "The delivery address is missing. Set push_api_url in the database.";
    } else {
      body.hint =
        "The delivery job has not run in the last three minutes. Check that the scheduled job exists in the database.";
    }
  }

  body.ok = body.jobAlive === true && body.vapid === true;

  return NextResponse.json(body);
}
