import { test } from "node:test";
import assert from "node:assert/strict";
import { buildICS } from "../src/lib/export.ts";

type Lecture = NonNullable<Parameters<typeof buildICS>[0]>[number];
type Event = NonNullable<Parameters<typeof buildICS>[1]>[number];

const enc = new TextEncoder();
const lines = (ics: string) => ics.split("\r\n");
const octets = (s: string) => enc.encode(s).length;

const lecture = (over: Partial<Lecture> = {}): Lecture =>
  ({
    id: "lec-1",
    subject_name: "رياضيات تطبيقية",
    subject_en: "Applied Math",
    code: "MATH101",
    doctor: "د. أحمد",
    hall: "قاعة 3",
    day: 2,
    start_time: "08:00",
    end_time: "09:50",
    kind: "lecture",
    color: "#123456",
    notes: "",
    department: "",
    created_date: "2026-09-01T00:00:00.000Z",
    ...over,
  }) as Lecture;

const event = (over: Partial<Event> = {}): Event =>
  ({
    id: "ev-1",
    title: "امتحان",
    title_en: "Exam",
    date: "2026-10-05",
    type: "exam",
    note: "",
    ...over,
  }) as Event;

test("wraps the calendar and declares the Egypt timezone", () => {
  const ics = buildICS([lecture()], [event()]);
  const ls = lines(ics);
  assert.equal(ls[0], "BEGIN:VCALENDAR");
  assert.equal(ls.at(-1), "END:VCALENDAR");
  assert.ok(ls.includes("X-WR-TIMEZONE:Africa/Cairo"));
  assert.equal(ls.filter((l) => l === "BEGIN:VEVENT").length, 2);
  assert.equal(ls.filter((l) => l === "END:VEVENT").length, 2);
});

test("every content line is at most 75 octets, folded when longer", () => {
  const note = "م".repeat(300);
  const ics = buildICS([lecture({ notes: note })], [event({ note })]);
  for (const line of lines(ics)) {
    assert.ok(
      octets(line) <= 75,
      `line of ${octets(line)} octets: ${line.slice(0, 30)}`,
    );
  }
  // Continuation lines must start with a single space (RFC 5545 §3.1).
  assert.ok(lines(ics).some((l) => l.startsWith(" ")));
});

test("folds on character boundaries, never mid UTF-8 sequence", () => {
  const ics = buildICS([lecture({ notes: "محاضرة مهمة " .repeat(40) })], []);
  // Re-join the folded description and compare with the original text.
  const joined = lines(ics).join("\r\n").replace(/\r\n /g, "");
  assert.ok(joined.includes("محاضرة مهمة ".repeat(40)));
  assert.ok(!joined.includes("\ufffd"));
});

test("all-day events end on the following day (exclusive DTEND)", () => {
  const ics = buildICS([], [event({ date: "2026-10-05" })]);
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20261005"));
  assert.ok(ics.includes("DTEND;VALUE=DATE:20261006"), "DTEND must be the next day");
});

test("DTEND rolls over month and year boundaries", () => {
  const ics = buildICS([], [event({ date: "2026-12-31" })]);
  assert.ok(ics.includes("DTEND;VALUE=DATE:20270101"));
  const leap = buildICS([], [event({ date: "2028-02-28" })]);
  assert.ok(leap.includes("DTEND;VALUE=DATE:20280229"));
});

test("timed events are pinned to Cairo, never to UTC", () => {
  const ics = buildICS([lecture()], []);
  assert.ok(ics.includes("DTSTART;TZID=Africa/Cairo:"));
  assert.ok(ics.includes("DTEND;TZID=Africa/Cairo:"));
  assert.ok(!/DTSTART:[^;]*Z\r/.test(ics), "local times must not be marked as UTC");
});

test("the DTSTART date really falls on the day the RRULE names", () => {
  // day 0=Sun … 6=Sat
  const byDay = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  for (let day = 0; day < 7; day++) {
    const ics = buildICS([lecture({ id: `l${day}`, day })], []);
    const dtstart = ics.match(/DTSTART;TZID=Africa\/Cairo:(\d{4})(\d{2})(\d{2})/);
    const rrule = ics.match(/BYDAY=(\w\w)/);
    assert.ok(dtstart && rrule, "both properties must exist");
    const [y, m, d] = [
      Number(dtstart[1]),
      Number(dtstart[2]),
      Number(dtstart[3]),
    ];
    const weekday = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][
      new Date(Date.UTC(y, m - 1, d)).getUTCDay()
    ];
    assert.equal(rrule[1], byDay[day], `day ${day} maps to ${byDay[day]}`);
    assert.equal(weekday, byDay[day], `DTSTART must fall on ${byDay[day]}`);
  }
});

test("UIDs are stable per entity and unique inside a file", () => {
  const a = buildICS([lecture({ id: "abc" })], []);
  const b = buildICS([lecture({ id: "abc" })], []);
  const uidA = a.match(/UID:([^\r]+)/)?.[1];
  const uidB = b.match(/UID:([^\r]+)/)?.[1];
  assert.equal(uidA, "abc@jadoli");
  assert.equal(uidA, uidB, "re-exporting must not duplicate events");

  const two = buildICS([lecture({ id: "x" }), lecture({ id: "y", day: 4 })], []);
  const uids = [...two.matchAll(/UID:([^\r]+)/g)].map((m) => m[1]);
  assert.equal(new Set(uids).size, 2);
});

test("escapes the characters RFC 5545 reserves", () => {
  const ics = buildICS(
    [lecture({ subject_name: "a,b;c\nd\\e", notes: 'say "hi"' })],
    [],
  );
  const body = lines(ics)
    .filter((l) => l.startsWith("SUMMARY:") || l.startsWith("DESCRIPTION:"))
    .join("\r\n")
    .replace(/\r\n /g, "");
  assert.ok(body.includes("a\\,b\\;c\\nd\\\\e"), body);
});

test("skips incomplete records instead of emitting broken events", () => {
  const ics = buildICS(
    [lecture({ id: "no-day", day: null as unknown as number }), lecture({ id: "ok" })],
    [event({ id: "no-date", date: "" })],
  );
  assert.equal(lines(ics).filter((l) => l === "BEGIN:VEVENT").length, 1);
});

test("an empty schedule still produces a valid calendar", () => {
  const ics = buildICS();
  assert.ok(ics.startsWith("BEGIN:VCALENDAR"));
  assert.ok(ics.endsWith("END:VCALENDAR"));
  assert.equal(ics.includes("VEVENT"), false);
});
