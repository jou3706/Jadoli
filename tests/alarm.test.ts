import { test } from "node:test";
import assert from "node:assert/strict";
import { browserStorage } from "./browser-shim.ts";
import {
  ALARM_GRACE_MINUTES,
  DEFAULT_REMIND_MINUTES,
  SNOOZE_MINUTES,
  alarmAt,
  alarmKey,
  alarmWindow,
  dueAlarms,
  eventStart,
  msUntilNextAlarm,
  remindChoices,
  remindMinutesOf,
} from "../src/lib/alarm.ts";
import {
  emptyAlarmStore,
  isEligible,
  markFired,
  markSnoozed,
  msUntilNextWake,
  pruneAlarmStore,
  readAlarmStore,
  writeAlarmStore,
} from "../src/lib/alarm-store.ts";
import type { SubjectEvent } from "../src/lib/db/types.ts";

const ev = (over: Partial<SubjectEvent> = {}): SubjectEvent => ({
  id: "e1",
  subject_key: "Calculus",
  title: "Midterm",
  kind: "exam",
  date: "2026-10-20",
  start_time: "09:00",
  end_time: "11:00",
  hall: "",
  note: "",
  remind_minutes: 60,
  created_date: "2026-10-01T00:00:00Z",
  ...over,
});

/** Local, so the test means the same thing whatever timezone it runs in. */
const at = (y: number, mo: number, d: number, h = 0, min = 0, sec = 0) =>
  new Date(y, mo - 1, d, h, min, sec, 0);

test("an event's start is read as the clock where the person is", () => {
  // The row holds a date and "09:00" with no zone. Nine in the morning here is
  // nine in the morning here, whatever Greenwich thinks.
  assert.equal(eventStart(ev())?.getTime(), at(2026, 10, 20, 9).getTime());
  assert.equal(eventStart(ev({ start_time: "" }))?.getTime(), at(2026, 10, 20, 12).getTime(),
    "no time set means somewhere in the day, not midnight");
  assert.equal(eventStart(ev({ date: "not-a-date" })), null);
});

test("the alarm is the start minus however far ahead was asked for", () => {
  assert.equal(alarmAt(ev())?.getTime(), at(2026, 10, 20, 8).getTime());
  assert.equal(
    alarmAt(ev({ remind_minutes: 0 }))?.getTime(),
    at(2026, 10, 20, 9).getTime(),
    "at the time means at the time",
  );
  assert.equal(
    alarmAt(ev({ remind_minutes: 1440 }))?.getTime(),
    at(2026, 10, 19, 9).getTime(),
  );
  assert.equal(remindMinutesOf(ev({ remind_minutes: undefined as never })), DEFAULT_REMIND_MINUTES);
});

test("the window opens at the reminder and closes after the start", () => {
  const before = alarmWindow(ev(), at(2026, 10, 20, 7, 59));
  assert.equal(before, null, "an hour early is not an alarm");

  const justAfter = alarmWindow(ev(), at(2026, 10, 20, 8, 0, 1));
  assert.ok(justAfter, "the moment it becomes true, it is true");

  const late = alarmWindow(ev(), at(2026, 10, 20, 9, ALARM_GRACE_MINUTES - 1));
  assert.ok(late, "arriving late still counts: you still have an exam to walk into");

  const tooLate = alarmWindow(ev(), at(2026, 10, 20, 11, 0));
  assert.equal(tooLate, null, "three hours into the exam is not a reminder");
});

test("arriving late is still inside the window", () => {
  // Someone opening the app five minutes before an exam with an hour's warning
  // must still be told: the warning is true now, whatever they missed.
  assert.ok(alarmWindow(ev(), at(2026, 10, 20, 8, 55)));
});

test("an alarm that already rang does not ring again", () => {
  const now = at(2026, 10, 20, 8, 30);
  const event = ev();
  const empty = emptyAlarmStore();
  assert.equal(isEligible(event, empty, now), true);

  const fired = markFired(empty, event, now.getTime());
  assert.equal(isEligible(event, fired, now), false, "not every thirty seconds until the tab closes");
  assert.equal(isEligible(event, fired, at(2026, 10, 20, 8, 45)), false);
});

test("moving the event lets it ring again", () => {
  const event = ev();
  const fired = markFired(emptyAlarmStore(), event, at(2026, 10, 20, 8).getTime());
  const moved = ev({ start_time: "11:00" });
  assert.equal(
    isEligible(moved, fired, at(2026, 10, 20, 10, 5)),
    true,
    "the exam moved: the alarm that rang for the old time says nothing about the new one",
  );
});

test("a snooze stops it for a while and then lets go on its own", () => {
  const event = ev();
  const until = at(2026, 10, 20, 8, 30).getTime() + SNOOZE_MINUTES * 60_000;
  const store = markSnoozed(markFired(emptyAlarmStore(), event, 0), event, until);

  assert.equal(isEligible(event, store, at(2026, 10, 20, 8, 35)), false, "asked to wait");
  assert.equal(
    isEligible(event, store, new Date(until + 1)),
    true,
    "nothing else has to tidy up: the wait simply runs out",
  );
});

test("only the alarms that are true are offered", () => {
  const now = at(2026, 10, 20, 8, 30);
  const events = [
    ev({ id: "soon", start_time: "09:00" }),
    ev({ id: "later", start_time: "15:00" }),
    ev({ id: "yesterday", date: "2026-10-19", start_time: "09:00" }),
    ev({ id: "tomorrow", date: "2026-10-21", start_time: "09:00" }),
  ];
  assert.deepEqual(
    dueAlarms(events, now).map((e) => e.id),
    ["soon"],
  );
});

test("the wait is until the alarm, not a fixed tick", () => {
  const now = at(2026, 10, 20, 7, 0);
  assert.equal(
    msUntilNextAlarm([ev({ start_time: "09:00" })], now),
    60 * 60_000,
    "an hour's warning means the alarm is an hour before the start",
  );
  assert.equal(
    msUntilNextAlarm([ev({ start_time: "15:00" })], now),
    7 * 60 * 60_000,
    "a 15:00 exam with an hour's warning rings at 14:00, not at 07:00",
  );
  assert.equal(
    msUntilNextAlarm([ev({ start_time: "15:00" }), ev({ start_time: "09:00" })], now),
    60 * 60_000,
    "the soonest of them, not the first in the list",
  );
  assert.equal(msUntilNextAlarm([], now), null);
});

test("the next wait knows about a snooze ending, not only an alarm arriving", () => {
  const now = at(2026, 10, 20, 8, 30);
  const event = ev({ start_time: "09:00" });
  const fired = markFired(emptyAlarmStore(), event, now.getTime());
  assert.equal(
    msUntilNextWake([event], fired, now),
    null,
    "already rang, nothing coming",
  );

  // Ring, then asked to wait. The event is still inside its window, so the only
  // moment left is the end of the wait - and waking for that is the whole
  // difference between a snooze and a silence.
  const until = now.getTime() + SNOOZE_MINUTES * 60_000;
  const snoozed = markSnoozed(fired, event, until);
  assert.equal(msUntilNextWake([event], snoozed, now), SNOOZE_MINUTES * 60_000);
  assert.equal(
    isEligible(event, snoozed, now),
    false,
    "and while it waits, it does not ring",
  );
});

test("the identity of an alarm includes its time", () => {
  assert.equal(alarmKey(ev()), "e1:2026-10-20:09:00");
  assert.notEqual(alarmKey(ev({ start_time: "11:00" })), alarmKey(ev()));
});

test("a reminder set by hand is still offered back", () => {
  assert.equal(remindChoices(60).some((c) => c.min === 60), true);
  assert.equal(remindChoices(45).some((c) => c.min === 45), true, "not one of the presets, kept anyway");
  assert.equal(remindChoices(45).some((c) => c.min === 60), true, "without losing the presets");
});

test("a store survives a reload, and belongs to one account only", () => {
  browserStorage.clear();
  const event = ev();
  writeAlarmStore("alice", markFired(emptyAlarmStore(), event, 123));

  assert.deepEqual(
    Object.keys(readAlarmStore("alice").fired),
    [alarmKey(event)],
    "a reload must not re-arm an alarm that already rang",
  );
  assert.deepEqual(
    readAlarmStore("bob").fired,
    {},
    "one person's device is not the other's: a shared laptop must not inherit alarms",
  );
});

test("a store that is not a store is read as empty, not as already fired", () => {
  // Reading junk as `{ fired: {...} }` would make every alarm look like it had
  // already rung, which is the quietest possible failure and the worst one.
  browserStorage.clear();
  for (const junk of ["not json", '{"fired":"yes"}', '{"fired":{"a":"soon"}}', "null"]) {
    browserStorage.set("jadwali_alarms:alice", junk);
    const store = readAlarmStore("alice");
    assert.deepEqual(store, { fired: {}, snoozed: {} }, `for ${junk}`);
  }
});

test("the past is pruned so last week cannot shape today", () => {
  const now = 20 * 86_400_000;
  const store = {
    fired: { recent: now - 1000, ancient: now - 40 * 86_400_000 },
    snoozed: {},
  };
  const pruned = pruneAlarmStore(store, now);
  assert.deepEqual(Object.keys(pruned.fired), ["recent"]);
});
