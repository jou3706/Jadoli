import { test } from "node:test";
import assert from "node:assert/strict";
import { dueReminders, isGoneStatus, reminderRange, subscriptionSchema } from "../src/lib/push.ts";
import type { SubjectEvent } from "../src/lib/db/types.ts";

const ev = (over: Partial<SubjectEvent> = {}): SubjectEvent => ({
  id: "e1",
  subject_key: "Physics 1",
  title: "Midterm",
  kind: "exam",
  date: "2026-10-20",
  start_time: "09:00",
  end_time: "11:00",
  hall: "",
  note: "",
  remind_minutes: 60,
  created_date: "",
  ...over,
});

const at = (iso: string) => new Date(iso);
const LONDON = "Europe/London";

test("a reminder is owed once the alarm moment arrives, in the reader's zone", () => {
  // 09:00 London on the 20th is 08:00Z, so the hour before is 07:00Z.
  const due = dueReminders([ev()], at("2026-10-20T07:00:00Z"), LONDON, new Set(), "en");
  assert.equal(due.length, 1);
  assert.equal(due[0].eventId, "e1");
  assert.match(due[0].body, /Exam at 09:00/);
});

test("a minute early it is not yet owed", () => {
  const due = dueReminders([ev()], at("2026-10-20T06:59:00Z"), LONDON, new Set(), "en");
  assert.deepEqual(due, []);
});

test("read in the server's zone instead of the reader's, it would be hours out", () => {
  // The failure this exists to prevent: the same event, judged in UTC, does not
  // become due until an hour after the student was told to revise.
  const event = ev();
  const now = at("2026-10-20T07:00:00Z");
  assert.equal(dueReminders([event], now, LONDON, new Set(), "en").length, 1);
  assert.equal(dueReminders([event], now, "UTC", new Set(), "en").length, 0);
});

test("an already-sent reminder stays sent, however late the tick is", () => {
  // The window has a grace period, so a per-minute job would otherwise send the
  // same reminder thirty times.
  const event = ev();
  const sent = new Set(["e1:2026-10-20:09:00"]);
  for (const minute of [0, 5, 20, 29]) {
    const now = at(`2026-10-20T07:${String(minute).padStart(2, "0")}:00Z`);
    assert.equal(
      dueReminders([event], now, LONDON, sent, "en").length,
      0,
      `must not repeat ${minute} minutes into the window`,
    );
  }
});

test("moving an exam re-arms it, because that is a different reminder", () => {
  // The identity is id:date:start_time on purpose - an exam pushed an hour
  // later should be allowed to ring again.
  const moved = ev({ start_time: "10:00" });
  const sent = new Set(["e1:2026-10-20:09:00"]);
  const due = dueReminders([moved], at("2026-10-20T08:00:00Z"), LONDON, sent, "en");
  assert.equal(due.length, 1, "the moved exam must ring again");
  assert.equal(due[0].key, "e1:2026-10-20:10:00");
});

test("after the grace period it is no longer a reminder", () => {
  const due = dueReminders([ev()], at("2026-10-20T11:31:00Z"), LONDON, new Set(), "en");
  assert.deepEqual(due, []);
});

test("the soonest thing comes first", () => {
  // Two things inside the same half-hour window, which is what a clash looks
  // like: a quiz at 09:00 and an exam at 09:20, both an hour ahead.
  // A quiz at 09:00 and an exam at 09:30, both an hour ahead, so at 07:30Z the
  // exam's moment has arrived and the quiz's is still inside its grace.
  const quiz = ev({ id: "b", start_time: "09:00", remind_minutes: 60 });
  const exam = ev({ id: "a", start_time: "09:30", remind_minutes: 60 });
  const due = dueReminders([exam, quiz], at("2026-10-20T07:30:00Z"), LONDON, new Set(), "en");
  assert.deepEqual(
    due.map((d) => d.eventId),
    ["b", "a"],
    "the earlier hour has to be the first thing read",
  );
});

test("the notification says what the thing is, in the reader's language", () => {
  const arabic = dueReminders([ev()], at("2026-10-20T07:00:00Z"), LONDON, new Set(), "ar")[0];
  assert.equal(arabic.title, "Physics 1");
  assert.match(arabic.body, /امتحان/);
  assert.match(arabic.body, /09:00/);

  const english = dueReminders([ev()], at("2026-10-20T07:00:00Z"), LONDON, new Set(), "en")[0];
  assert.equal(english.title, "Physics 1");
  assert.match(english.body, /Midterm/);
});

test("an assignment reads as a deadline rather than as a sitting", () => {
  // `remind_minutes: 0` means at the moment it starts, so the window opens at
  // 08:00Z and is gone by 08:30Z.
  const due = dueReminders(
    [ev({ kind: "assignment", title: "Problem set 3", remind_minutes: 0 })],
    at("2026-10-20T08:05:00Z"),
    LONDON,
    new Set(),
    "en",
  );
  assert.equal(due.length, 1);
  assert.match(due[0].body, /Assignment due at 09:00/);
});

test("an event with no course name still reads as something", () => {
  const due = dueReminders(
    [ev({ subject_key: "", title: "" })],
    at("2026-10-20T07:00:00Z"),
    LONDON,
    new Set(),
    "en",
  );
  assert.equal(due.length, 1);
  assert.ok(due[0].title.length > 0, "a nameless event still needs a heading");
});

test("the tag matches the key, so a retry replaces rather than stacks", () => {
  const due = dueReminders([ev()], at("2026-10-20T07:00:00Z"), LONDON, new Set(), "en")[0];
  assert.equal(due.tag, due.key);
  assert.equal(due.url, "/events");
});

test("the range asked of the database is the reader's own week", () => {
  // 23:30Z on the 19th is already the 20th in London.
  const range = reminderRange(at("2026-10-19T23:30:00Z"), LONDON);
  assert.equal(range.from, "2026-10-20");
  assert.equal(range.to, "2026-10-27", "a week ahead is the furthest anything can be reminded");
});

test("a subscription is only accepted with the two keys a push service needs", () => {
  const good = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: { p256dh: "p", auth: "a" },
  };
  assert.equal(subscriptionSchema.safeParse(good).success, true);
  assert.equal(subscriptionSchema.safeParse({ ...good, keys: { p256dh: "p" } }).success, false);
  assert.equal(subscriptionSchema.safeParse({ ...good, endpoint: "not-a-url" }).success, false);
  assert.equal(subscriptionSchema.safeParse({ keys: good.keys }).success, false);
});

test("a zone the runtime does not know is refused, not stored as UTC", () => {
  // Storing it as UTC would mean reading it as UTC, and every reminder for that
  // person would land at the wrong hour with nothing to show for it.
  const base = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: { p256dh: "p", auth: "a" },
  };
  assert.equal(
    subscriptionSchema.safeParse({ ...base, timeZone: "Mars/Olympus" }).success,
    false,
  );
  assert.equal(subscriptionSchema.safeParse({ ...base, timeZone: "Africa/Cairo" }).success, true);
  // A subscription with no zone is allowed, and read as UTC: a missing value is
  // a different problem from a wrong one.
  assert.equal(subscriptionSchema.parse(base).timeZone, "UTC");
});

test("only a vanished endpoint retires a subscription", () => {
  assert.equal(isGoneStatus(404), true);
  assert.equal(isGoneStatus(410), true);
  // Everything else is a bad afternoon, not a reason to take reminders away.
  for (const status of [400, 401, 403, 429, 500, 502, 503]) {
    assert.equal(isGoneStatus(status), false, `${status} must be retried, not dropped`);
  }
});