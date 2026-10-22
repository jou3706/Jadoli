import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import {
  dueReminders,
  isGoneStatus,
  reminderRange,
  subscriptionSchema,
  type PushLanguage,
} from "@/lib/push";
import { alarmKey } from "@/lib/alarm";

/**
 * Delivering a reminder to a browser that is not running the app.
 *
 * The route is called by a database job once a minute and holds no session of its
 * own - a cron job cannot sign in as anybody - so it is guarded by a shared
 * secret in a header rather than by a token. Two things follow from that, and
 * both are the reason this file is careful:
 *
 *  - It reads and writes with the service role key, which bypasses RLS. Every
 *    query here is therefore written by hand against its own owner, because
 *    nothing below will stop it from reading another student's rows.
 *  - It never holds anything that identifies a student beyond what the push
 *    itself needs: the endpoint and the notification text. A send log that
 *    could name who was told what, and when, is a different product than this.
 */

/**
 * The three tables this module reads and writes, described by hand.
 *
 * Written out rather than generated because the alternative is an untyped client,
 * where a write is typed `never` and a mistyped column name is discovered by the
 * cron job at three in the morning instead of by the compiler. This is the only
 * place with the service role key, so the columns it names are the ones that
 * decide whose reminders are read and whose are sent - they are worth checking.
 */
type SubscriptionInsert = Omit<StoredSubscription, "id"> & {
  last_seen?: string;
  created_date?: string;
};
type DeliveryInsert = { user_id: string; alarm_key: string; sent_at?: string };
type EventInsert = Partial<EventRow> & { user_id: string; date: string };
type TickInsert = {
  subscriptions?: number;
  sent?: number;
  failed?: number;
  removed?: number;
  reminders?: number;
};

type PushDatabase = {
  public: {
    Tables: {
      push_subscriptions: {
        Row: StoredSubscription & { last_seen: string; created_date: string };
        Insert: SubscriptionInsert;
        Update: Partial<SubscriptionInsert>;
        Relationships: [];
      };
      push_deliveries: {
        Row: { id: string; user_id: string; alarm_key: string; sent_at: string };
        Insert: DeliveryInsert;
        Update: Partial<DeliveryInsert>;
        Relationships: [];
      };
      /**
       * The heartbeat of the delivery job.
       *
       * A row is written every time the sender runs, whether or not it had
       * anything to send. It is the only thing that can say "the job is alive
       * and has nothing to say" - without it, a job that stopped running and a
       * job that ran and found no reminders look exactly the same, which is the
       * same silence that made a broken reminder look like a quiet week.
       */
      push_ticks: {
        Row: {
          id: number;
          at: string;
          subscriptions: number;
          sent: number;
          failed: number;
          removed: number;
          reminders: number;
        };
        Insert: TickInsert;
        Update: Partial<TickInsert>;
        Relationships: [];
      };
      /**
       * The two values the delivery job needs and cannot invent: where the
       * deployed app is, and the secret that identifies the job to it.
       *
       * The live table has been seen in two shapes - `(name, secret)` and
       * `(name, value)` - so both columns are read and the newer one is
       * written. Which one is in use is never decided by a guess.
       */
      app_secrets: {
        Row: { name: string; secret: string | null; value: string | null; created_at: string };
        Insert: { name: string; secret?: string; value?: string };
        Update: Partial<{ name: string; secret: string | null; value: string | null }>;
        Relationships: [];
      };
      subject_events: {
        Row: EventRow;
        Insert: EventInsert;
        Update: Partial<EventRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

/** The one client type every helper below takes, so no query goes untyped. */
export type PushClient = SupabaseClient<PushDatabase>;

/** The tables this module touches. Named here so a rename breaks one line. */
const SUBSCRIPTIONS = "push_subscriptions";
const DELIVERIES = "push_deliveries";
const TICKS = "push_ticks";
const SECRETS = "app_secrets";

export type StoredSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  language: PushLanguage;
  time_zone: string;
};

type EventRow = {
  id: string;
  user_id: string;
  subject_key: string;
  title: string;
  kind: "quiz" | "exam" | "assignment" | "other";
  date: string;
  start_time: string;
  end_time: string;
  hall: string;
  note: string;
  remind_minutes: number;
  created_date: string;
};

/** A client with the service role, which is the only one that can see every row. */
export function serviceClient(): PushClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NO_BACKEND");
  return createClient<PushDatabase>(url, key, {
    // Serverless keeps no memory between invocations, and there is nothing here
    // worth carrying over anyway.
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The VAPID pair, or null when push has not been set up. */
export function vapidKeys(): { publicKey: string; privateKey: string } | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey };
}

/**
 * Whether the header carries the secret the database was told to send.
 *
 * Compared the way two secrets should be: in full, over their own lengths, with
 * no early exit on the first difference. A `!==` on a header is the kind of
 * shortcut that leaks the secret one character at a time.
 */
export function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * Everything owed to one subscriber, in the order it should arrive.
 *
 * The range is asked for per zone rather than once for everyone, because "today"
 * is the reader's today and a subscriber in Auckland is a day ahead of the
 * server. Querying one shared range would either miss their morning or hand
 * everyone a second day of events nobody asked for.
 */
export async function remindersFor(sb: PushClient, sub: StoredSubscription, now: Date) {
  const { from, to } = reminderRange(now, sub.time_zone);

  const { data: events, error } = await sb
    .from("subject_events")
    .select("id,user_id,subject_key,title,kind,date,start_time,end_time,hall,note,remind_minutes,created_date")
    .eq("user_id", sub.user_id)
    .gte("date", from)
    .lte("date", to)
    .limit(200);
  if (error) throw new Error(`EVENTS:${error.message}`);

  const { data: sent, error: sentError } = await sb
    .from(DELIVERIES)
    .select("alarm_key")
    .eq("user_id", sub.user_id);
  if (sentError) throw new Error(`SENT:${sentError.message}`);

  const rows = (events ?? []) as unknown as EventRow[];
  const already = new Set(
    ((sent ?? []) as { alarm_key: string }[]).map((r) => String(r.alarm_key)),
  );

  return dueReminders(
    rows as unknown as Parameters<typeof dueReminders>[0],
    now,
    sub.time_zone,
    already,
    sub.language,
  );
}

/**
 * Record that these reminders have gone out.
 *
 * Written after the send, not before: a row written first is a reminder that is
 * never delivered if the process dies between the two, and a missed exam is worse
 * than a duplicate one - the notification replaces itself in the tray anyway,
 * because it carries the same tag.
 */
export async function markDelivered(sb: PushClient, userId: string, keys: string[]) {
  if (!keys.length) return;
  const { error } = await sb
    .from(DELIVERIES)
    .upsert(
      keys.map((k) => ({ user_id: userId, alarm_key: k })),
      { onConflict: "user_id,alarm_key", ignoreDuplicates: true },
    );
  if (error) throw new Error(`MARK:${error.message}`);
}

/** Forgets a subscription the push service says no longer exists. */
export async function forgetSubscription(sb: PushClient, id: string) {
  await sb.from(SUBSCRIPTIONS).delete().eq("id", id);
}

/** Touches the row that worked, so pruning can tell live ones from forgotten. */
export async function touchSubscription(sb: PushClient, id: string) {
  await sb.from(SUBSCRIPTIONS).update({ last_seen: new Date().toISOString() }).eq("id", id);
}

/**
 * Records that the delivery job ran.
 *
 * Written whether or not there was anything to send, because "the job ran and
 * had nothing to say" and "the job did not run" are the two answers a person
 * needs, and only the first of them leaves a mark. A heartbeat that is only
 * written when something is sent cannot tell a quiet week from a dead job.
 */
export async function recordTick(sb: PushClient, counts: TickInsert) {
  const { error } = await sb.from(TICKS).insert({
    subscriptions: counts.subscriptions ?? 0,
    sent: counts.sent ?? 0,
    failed: counts.failed ?? 0,
    removed: counts.removed ?? 0,
    reminders: counts.reminders ?? 0,
  });
  if (error) throw new Error(`TICK:${error.message}`);
}

/**
 * The most recent heartbeat, or null when there has never been one.
 *
 * Null is a real answer - it means the job has never run - and it is not the
 * same as an old row.
 */
/** What one delivery pass did. */
export type DeliverySummary = {
  subscriptions: number;
  sent: number;
  failed: number;
  removed: number;
  reminders: number;
  /**
   * Why the last send failed, if one did.
   *
   * A delivery that fails silently is the thing this whole arrangement was
   * built to end, so the reason is reported rather than swallowed. It is
   * stripped of anything that identifies the subscription: the address of a
   * push endpoint is a credential in itself, and a screenshot of it is a
   * screenshot of somebody else's phone.
   */
  lastError?: string;
};

/** The heartbeat of the delivery job, as it is stored. */
export type TickRow = {
  at: string;
  subscriptions: number;
  sent: number;
  failed: number;
  removed: number;
  reminders: number;
};

/**
 * The heartbeat of the delivery job, and whether it has a table to live in.
 *
 * A database that has not been migrated yet has no `push_ticks` table, and
 * that is a fact about the migration rather than a failure of the job - so it
 * is reported as its own answer instead of an error.
 */
export async function tickStatus(sb: PushClient): Promise<{ table: boolean; last: TickRow | null }> {
  const { data, error } = await sb
    .from(TICKS)
    .select("at,subscriptions,sent,failed,removed,reminders")
    .order("at", { ascending: false })
    .limit(1);
  if (error) {
    if (/could not find the table|does not exist/i.test(error.message)) {
      return { table: false, last: null };
    }
    throw new Error(`TICK:${error.message}`);
  }
  const row = (data ?? [])[0];
  return { table: true, last: (row as TickRow | undefined) ?? null };
}/**
 * What the push service said, without anything that identifies the student.
 *
 * The address of a push endpoint carries a token that lets anyone who has it
 * send to that phone, so it is removed from every message. What is left is
 * the status code and the reason, which is what a person can act on.
 */
function safeError(e: unknown): string {
  const raw = (e as { message?: string; statusCode?: number })?.message ?? "unknown error";
  const status = (e as { statusCode?: number })?.statusCode;
  const stripped = raw
    .replace(/https?:\/\/\S+/g, "<endpoint>")
    .replace(/[A-Za-z0-9_-]{40,}/g, "<token>")
    .slice(0, 200);
  return status ? `${status}: ${stripped}` : stripped;
}

/**
 * The delivery job's own configuration, read the way the database holds it.
 *
 * Returns the names that are set and the address of the deployed app, and
 * never the secret itself: this is what a health check answers with, and a
 * secret printed in a browser console is a secret in a screenshot.
 *
 * The secrets table is read twice, on purpose. The live database was created
 * with a `secret` column, and the migration adds a `value` column beside it -
 * so a database that has not been migrated yet answers a question about
 * `value` with an error rather than with the value it already has. Asking
 * again without that column is what makes the health check useful on a
 * database that is one step behind: the answer is still there, and the check
 * can say "the migration has not been applied" instead of giving up.
 */
export async function deliveryConfig(sb: PushClient) {
  let rows: { name: string; secret: string | null; value: string | null }[] = [];
  let shape: "value" | "secret" | "none" = "none";

  const full = await sb.from(SECRETS).select("name,secret,value");
  if (!full.error) {
    rows = (full.data ?? []) as { name: string; secret: string | null; value: string | null }[];
    shape = "value";
  } else {
    const legacy = await sb.from(SECRETS).select("name,secret");
    if (legacy.error) throw new Error(`SECRETS:${legacy.error.message}`);
    rows = (legacy.data ?? []) as { name: string; secret: string | null; value: string | null }[];
    shape = "secret";
  }

  const byName = new Map(rows.map((r) => [r.name, r]));
  const url = byName.get("push_api_url");
  const secret = byName.get("push_cron_secret");
  const apiUrl = (url?.value ?? url?.secret ?? "").trim();
  const cronSecret = (secret?.value ?? secret?.secret ?? "").trim();
  return {
    apiUrl: apiUrl || null,
    apiUrlSet: Boolean(apiUrl),
    cronSecretSet: Boolean(cronSecret),
    /**
     * Which shape the table is in. "value" is the migrated one; "secret" means
     * the database is running the old schema, which is a fact worth reporting
     * rather than a reason to throw.
     */
    shape: shape as "value" | "secret",
  };
}

/**
 * Sends what is owed to a set of subscribers.
 *
 * Shared by the two callers that deliver: the database job, which sees every
 * subscriber, and the student's own browser, which sees only their own. The
 * rules are the same in both - what differs is whose subscriptions are in the
 * list - so the rules live here rather than in either route.
 *
 * The shape of a run: for each subscription, work out what that reader owes
 * from their own zone, send it, and write down what went out. Subscriptions
 * the push service reports as gone are deleted in the same pass, because a row
 * that can never be delivered to is a row that costs a lookup every minute
 * forever.
 */
export async function deliverTo(
  sb: PushClient,
  subs: StoredSubscription[],
  now = new Date(),
): Promise<DeliverySummary> {
  const summary: DeliverySummary = {
    subscriptions: 0,
    sent: 0,
    failed: 0,
    removed: 0,
    reminders: 0,
  };

  const keys = vapidKeys();
  if (!keys) throw new Error("NO_VAPID");

  webpush.setVapidDetails(
    process.env.NEXT_PUBLIC_SITE_URL || "mailto:jadwali@example.com",
    keys.publicKey,
    keys.privateKey,
  );

  for (const row of subs) {
    summary.subscriptions += 1;

    let reminders;
    try {
      reminders = await remindersFor(sb, row, now);
    } catch {
      // One reader's broken row must not stop everyone else's reminders going
      // out on this tick. It is reported and the next tick tries again.
      summary.failed += 1;
      continue;
    }

    if (reminders.length === 0) continue;
    summary.reminders += reminders.length;

    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    };
    const sentKeys: string[] = [];
    let live = true;

    for (const reminder of reminders) {
      try {
        await webpush.sendNotification(
          subscription,
          JSON.stringify({
            title: reminder.title,
            body: reminder.body,
            tag: reminder.tag,
            url: reminder.url,
            eventId: reminder.eventId,
          }),
          { TTL: 3600 },
        );
        summary.sent += 1;
        sentKeys.push(reminder.key);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode ?? 0;
        if (isGoneStatus(status)) {
          // The endpoint is dead: cleared in the browser, or the profile gone.
          await forgetSubscription(sb, row.id);
          summary.removed += 1;
          live = false;
          break;
        }
        // A 429 or a 5xx is the push service having a moment. Leave the row
        // alone: this reminder simply goes out on a later tick, and the ledger
        // still says it has not been sent.
        summary.failed += 1;
        summary.lastError = safeError(e);
      }
    }

    if (live && sentKeys.length) {
      try {
        await markDelivered(sb, row.user_id, sentKeys);
        await touchSubscription(sb, row.id);
      } catch {
        // The push went out but the ledger did not, so the next tick would send
        // it again. The tag makes that a replacement in the tray rather than a
        // second notification, which is the survivable version of this bug.
        summary.failed += 1;
      }
    }
  }

  return summary;
}

export { isGoneStatus, subscriptionSchema, alarmKey };