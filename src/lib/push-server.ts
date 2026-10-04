import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

export const VAPID_SUBJECT = process.env.NEXT_PUBLIC_SITE_URL || "mailto:jadoli@example.com";

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

export { isGoneStatus, subscriptionSchema, alarmKey };