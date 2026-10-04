import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, civilDateIn, clockIn, instantOfCivil, isTimeZone, zoneOffsetMs } from "../src/lib/tz.ts";

const at = (iso: string) => new Date(iso);

/** The instant, as a readable local-in-UTC stamp, for a failure message. */
const show = (d: Date | null) => (d ? d.toISOString() : "null");

test("a zone the runtime has never heard of is not accepted", () => {
  assert.equal(isTimeZone("Africa/Cairo"), true);
  assert.equal(isTimeZone("Europe/London"), true);
  assert.equal(isTimeZone("Mars/Olympus"), false);
  assert.equal(isTimeZone(""), false);
  assert.equal(isTimeZone("x".repeat(65)), false);
});

test("east of Greenwich is a positive offset", () => {
  // Zones with settled rules, so this does not become a test of tzdata.
  assert.equal(zoneOffsetMs(at("2026-10-20T00:00:00Z"), "UTC"), 0);
  assert.equal(zoneOffsetMs(at("2026-10-20T00:00:00Z"), "Europe/London"), 3600_000);
  assert.equal(zoneOffsetMs(at("2026-10-20T00:00:00Z"), "America/New_York"), -4 * 3600_000);
  assert.ok(zoneOffsetMs(at("2026-10-20T00:00:00Z"), "Africa/Cairo") > 0);
});

test("nine in the morning is nine where the student is, not where the server is", () => {
  // This is the bug the whole module exists for. The server is UTC; a London
  // student's 09:00 exam is 08:00 UTC in October, and reading it as 09:00 UTC
  // would ring an hour late for every student not on Greenwich.
  assert.equal(
    show(instantOfCivil("2026-10-20", "09:00", "Europe/London")),
    "2026-10-20T08:00:00.000Z",
  );
  assert.equal(
    show(instantOfCivil("2026-10-20", "09:00", "America/New_York")),
    "2026-10-20T13:00:00.000Z",
  );
  assert.equal(
    show(instantOfCivil("2026-10-20", "09:00", "UTC")),
    "2026-10-20T09:00:00.000Z",
  );
});

test("two students in two zones are not sent the same instant", () => {
  const zones = ["Africa/Cairo", "Europe/London", "America/New_York", "Asia/Tokyo", "UTC"];
  const instants = zones.map((z) => show(instantOfCivil("2026-10-20", "09:00", z)));
  assert.equal(new Set(instants).size, zones.length, "each zone must answer for itself");
});

test("a civil time reads back as itself, in every zone, all year", () => {
  // The invariant the reminders depend on, rather than any one country's rules:
  // whatever the zone or the date, an event at 09:00 must be read back as 09:00.
  // Anything less and a reminder is wrong by that much, silently.
  const zones = [
    "Africa/Cairo",
    "Europe/London",
    "Europe/Berlin",
    "America/New_York",
    "America/Sao_Paulo",
    "Asia/Tokyo",
    "Asia/Kolkata",
    "Australia/Sydney",
    "Pacific/Auckland",
    "UTC",
  ];
  // A fortnightly walk across the year, so both clock changes in each are inside
  // it rather than one lucky pair of dates.
  for (const zone of zones) {
    for (let month = 0; month < 12; month++) {
      for (const day of [1, 15, 28]) {
        const date = `2026-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const instant = instantOfCivil(date, "09:00", zone);
        assert.ok(instant, `${date} 09:00 ${zone} must be a real instant`);
        assert.equal(civilDateIn(instant, zone), date, `${date} 09:00 in ${zone}`);
        assert.equal(clockIn(instant, zone), "09:00", `${date} 09:00 in ${zone}`);
      }
    }
  }
});

test("the date can land on a different day in UTC than in the zone", () => {
  assert.equal(
    show(instantOfCivil("2026-10-20", "01:30", "Europe/London")),
    "2026-10-20T00:30:00.000Z",
  );
  assert.equal(
    show(instantOfCivil("2026-10-20", "23:30", "America/New_York")),
    "2026-10-21T03:30:00.000Z",
  );
});

test("daylight saving is solved rather than assumed", () => {
  // London moves to UTC+1 on the 29th of March 2026. An hour either side of it
  // has to come out right, or every reminder in that week is an hour out.
  assert.equal(
    show(instantOfCivil("2026-03-28", "12:00", "Europe/London")),
    "2026-03-28T12:00:00.000Z",
  );
  assert.equal(
    show(instantOfCivil("2026-03-30", "12:00", "Europe/London")),
    "2026-03-30T11:00:00.000Z",
  );
  // And the hour the clocks go forward is an hour that does not exist there.
  assert.equal(
    show(instantOfCivil("2026-03-29", "12:00", "Europe/London")),
    "2026-03-29T11:00:00.000Z",
  );
});

test("an event with no hour set is midday, on the reader's clock", () => {
  // Midnight would ring the night before, which is how an exam ends up announced
  // at one in the morning.
  assert.equal(
    show(instantOfCivil("2026-10-20", "", "Europe/London")),
    "2026-10-20T11:00:00.000Z",
  );
});

test("a broken date or hour is refused rather than guessed at", () => {
  assert.equal(instantOfCivil("20-10-2026", "09:00", "UTC"), null);
  assert.equal(instantOfCivil("not-a-date", "09:00", "UTC"), null);
  assert.equal(instantOfCivil("2026-10-20", "99:99", "UTC"), null);
  assert.equal(instantOfCivil("", "", "UTC"), null);
});

test("an unknown zone falls back to UTC rather than throwing", () => {
  // A row written before the zone was stored has none. Reading it as UTC is
  // wrong for that one person and no worse than refusing to remind them at all.
  assert.equal(
    show(instantOfCivil("2026-10-20", "09:00", "Mars/Olympus")),
    "2026-10-20T09:00:00.000Z",
  );
});

test("midnight reads back as midnight, not as the 24th hour", () => {
  assert.equal(civilDateIn(at("2026-10-19T23:00:00Z"), "Europe/London"), "2026-10-20");
  assert.equal(civilDateIn(at("2026-10-20T00:00:00Z"), "Europe/London"), "2026-10-20");
  assert.equal(clockIn(at("2026-10-20T00:00:00Z"), "Europe/London"), "01:00");
  assert.equal(clockIn(at("2026-10-20T00:00:00Z"), "UTC"), "00:00");
});

test("adding days crosses months, years and a leap day", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-01-01", 0), "2026-01-01");
  assert.equal(addDays("not-a-date", 3), "not-a-date");
});