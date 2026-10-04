/**
 * Civil time against a named zone.
 *
 * The app stores an exam as a calendar date and a wall clock - "2026-10-20" and
 * "09:00" - with no zone attached, because that is how a timetable reads: nine in
 * the morning where the person is standing. On the device that is free, because
 * the browser's own clock is the person's clock.
 *
 * It stops being free the moment a server has to answer the question. Push is
 * sent by a cron job on someone else's machine, in UTC, and `new Date(2026, 9,
 * 20, 9, 0)` there is nine in the morning in London. Every reminder would then
 * arrive at the wrong hour, by an hour or two, and twice a year by another hour
 * again. So the zone the subscription was made in travels with it, and the civil
 * fields are turned into a real instant here rather than anywhere else.
 *
 * No date library: the offset is read back out of `Intl`, which is the same
 * answer the browser gives the device, so both sides of a reminder agree.
 */

/** True when the runtime knows this zone, rather than silently assuming UTC. */
export function isTimeZone(zone: string): boolean {
  if (!zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const partsIn = (instant: Date, timeZone: string) => {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) if (p.type !== "literal") out[p.type] = p.value;
  // `hour` comes back as 24 for midnight in some ICU builds, which is the same
  // hour as 0 and would otherwise shift the whole day by one.
  const hour = Number(out.hour) % 24;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour,
    minute: Number(out.minute),
    second: Number(out.second),
  };
};

/**
 * How far the zone's clock is from UTC at this instant, in milliseconds.
 *
 * Read by formatting the instant in the zone and reading the result back as if
 * it were UTC: the difference between the two is the offset. Positive east of
 * Greenwich, which is the sign `Date.UTC` arithmetic needs.
 */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  if (!isTimeZone(timeZone)) return 0;
  const p = partsIn(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Seconds are dropped from `instant` on purpose: the zone reports whole
  // seconds, and keeping the milliseconds would make every offset a fraction
  // of a second off and drift the answer.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The real instant a civil date and clock name in that zone.
 *
 * Solved rather than looked up: the offset depends on the instant being asked
 * about, and the instant being asked about depends on the offset. Two passes are
 * enough - the first is right except within an hour of a DST change, and the
 * second is read at the instant the first produced, which is on the far side of
 * any such change.
 */
export function instantOfCivil(
  date: string,
  time: string,
  timeZone: string,
): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (!d) return null;
  const [, y, mo, day] = d;
  const [hh, mm] = /^(\d{1,2}):(\d{2})$/.exec(time ?? "")?.slice(1).map(Number) ?? [12, 0];
  if (hh > 23 || mm > 59) return null;
  const zone = isTimeZone(timeZone) ? timeZone : "UTC";
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(day), hh, mm, 0, 0);
  if (Number.isNaN(wall)) return null;
  const guess = new Date(wall - zoneOffsetMs(new Date(wall), zone));
  return new Date(wall - zoneOffsetMs(guess, zone));
}

/** The calendar date an instant falls on in that zone, as `YYYY-MM-DD`. */
export function civilDateIn(instant: Date, timeZone: string): string {
  const zone = isTimeZone(timeZone) ? timeZone : "UTC";
  const p = partsIn(instant, zone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** `hh:mm` in that zone, for a notification that says when something is. */
export function clockIn(instant: Date, timeZone: string): string {
  const zone = isTimeZone(timeZone) ? timeZone : "UTC";
  const p = partsIn(instant, zone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** A date `days` after `date`, without a Date object in between. */
export function addDays(date: string, days: number): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (!d) return date;
  const [, y, mo, day] = d;
  const shifted = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(day) + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}