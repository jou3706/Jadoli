import { z } from "zod";
import type { SubjectEvent } from "./db/types";
import { ALARM_GRACE_MINUTES, alarmKey, alarmWindow } from "./alarm";
import { addDays, civilDateIn, clockIn, isTimeZone } from "./tz";

/**
 * Reminders that arrive when the app is closed.
 *
 * Everything here is decided by a cron job on a server, so the two things the
 * app gets for free on a device have to be argued for explicitly: the person's
 * time zone (they are not in the server's) and the fact that a reminder must
 * arrive once rather than once a minute.
 *
 * The subscription carries the zone, because that is the only moment the app
 * knows it - the browser is the one place that knows whose clock it is on. The
 * "already sent" half is a table rather than a timestamp, and the reason is
 * `alarmKey`: an exam moved an hour later is a different reminder and has to be
 * free to ring again, while the same exam at the same time must never ring twice.
 */

export type PushLanguage = "ar" | "en";

/** One browser's subscription, as the browser itself hands it over. */
export const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(400),
    auth: z.string().min(1).max(400),
  }),
  language: z.enum(["ar", "en"]).default("ar"),
  // Read from `Intl.DateTimeFormat().resolvedOptions().timeZone` at subscribe
  // time. Validated rather than trusted: a zone the runtime has never heard of
  // would be read as UTC, quietly, and every reminder would land at the wrong
  // hour for that one person.
  timeZone: z
    .string()
    .min(1)
    .max(64)
    .refine(isTimeZone, { message: "Unknown time zone" })
    .default("UTC"),
});

export type PushSubscription = z.infer<typeof subscriptionSchema>;

/** How far ahead an event can ask to be reminded: the column's own ceiling. */
const LOOKAHEAD_DAYS = 7;

/** A reminder that is owed right now, ready to be turned into a notification. */
export type PushReminder = {
  /** Identity of this ringing, and the row that stops it ringing again. */
  key: string;
  eventId: string;
  subjectKey: string;
  /** The event's own name, as it was written down. */
  eventTitle: string;
  kind: SubjectEvent["kind"];
  /** The moment it starts, as a real instant. */
  start: number;
  /** What the notification says, in the reader's language. */
  title: string;
  body: string;
  tag: string;
  url: string;
};

/** Where tapping the notification lands. The events page is the honest target:
 * an alarm is a thing to look at, not a thing to deep-link past. */
const url = "/events";

/**
 * The two sentences a reminder is made of.
 *
 * Written per event kind rather than one template, because the useful sentence
 * is not "you have an exam" for all of them: an assignment wants the deadline,
 * an exam wants the hour, and both want the course they belong to, which is the
 * one word a student with six similar courses needs.
 */
function wording(
  event: SubjectEvent,
  at: Date,
  timeZone: string,
  language: PushLanguage,
): { title: string; body: string } {
  const subject = String(event.subject_key ?? "").trim();
  const title = String(event.title ?? "").trim();
  const clock = clockIn(at, timeZone);
  const course = subject || title;
  const both = [subject, title].filter(Boolean).join(" · ");

  if (language === "en") {
    const verb =
      event.kind === "exam" ? "Exam" : event.kind === "quiz" ? "Quiz" : event.kind === "assignment" ? "Assignment due" : "Reminder";
    return {
      title: course || verb,
      body: `${verb} at ${clock}${both && both !== course ? ` · ${both}` : ""}`,
    };
  }
  const word =
    event.kind === "exam" ? "امتحان" : event.kind === "quiz" ? "كويز" : event.kind === "assignment" ? "تسليم" : "تذكير";
  return {
    title: course || word,
    body: `${word} الساعة ${clock}${both && both !== course ? ` · ${both}` : ""}`,
  };
}

/**
 * Every reminder this one person's events owe right now, soonest first.
 *
 * `sent` is the set of `alarmKey`s already delivered. The window has a grace
 * period, which is what lets someone who opens the app late still be told - and
 * which on a server would otherwise send the same reminder on every tick for
 * half an hour. Checking the ledger is what makes a minute-accurate schedule
 * possible at all.
 */
export function dueReminders(
  events: SubjectEvent[],
  now: Date,
  timeZone: string,
  sent: ReadonlySet<string>,
  language: PushLanguage = "ar",
  graceMinutes = ALARM_GRACE_MINUTES,
): PushReminder[] {
  const zone = isTimeZone(timeZone) ? timeZone : "UTC";
  const out: PushReminder[] = [];

  for (const event of events) {
    const window = alarmWindow(event, now, graceMinutes, zone);
    if (!window) continue;
    const key = alarmKey(event);
    if (sent.has(key)) continue;
    const start = new Date(window.start);
    const said = wording(event, start, zone, language);
    out.push({
      key,
      eventId: String(event.id ?? ""),
      subjectKey: String(event.subject_key ?? ""),
      eventTitle: String(event.title ?? ""),
      kind: event.kind,
      start: window.start,
      title: said.title,
      body: said.body,
      // The tag is the same identity as the key: a second push for the same
      // reminder replaces the first in the tray instead of stacking on it,
      // which is what a retry after a flaky send looks like to the student.
      tag: key,
      url,
    });
  }

  return out.sort((a, b) => a.start - b.start || a.key.localeCompare(b.key));
}

/**
 * The date range worth asking the database for.
 *
 * Bounded at both ends by the reader's own calendar: an event seven days out is
 * the furthest anything can be reminded (`remind_minutes` tops out at a week),
 * and anything before today has already started, so asking for it is a scan of
 * every past exam on the account.
 */
export function reminderRange(now: Date, timeZone: string): { from: string; to: string } {
  const zone = isTimeZone(timeZone) ? timeZone : "UTC";
  const today = civilDateIn(now, zone);
  return { from: today, to: addDays(today, LOOKAHEAD_DAYS) };
}

/**
 * Whether a failed send means this subscription should be forgotten.
 *
 * A push service answers 404 or 410 when the endpoint it holds is gone - the
 * browser cleared it, or the profile was removed - and retrying it forever grows
 * the table with rows that can never work. Anything else is a transient problem
 * worth trying again, and dropping the subscription over a bad afternoon would
 * silently take a student's reminders away.
 */
export const isGoneStatus = (status: number) => status === 404 || status === 410;