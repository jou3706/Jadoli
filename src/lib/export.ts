"use client";

/* ── ICS (RFC 5545) ─────────────────────────────────────────── */

/** The university is always on Egypt time; ICS readers resolve the IANA zone. */
const TZID = "Africa/Cairo";
const MAX_OCTETS = 75;

const encoder = new TextEncoder();
const charBytes = new Map<string, number>();
const byteLen = (s: string) => {
  let n = 0;
  for (const ch of s) {
    let w = charBytes.get(ch);
    if (w === undefined) {
      w = encoder.encode(ch).length;
      charBytes.set(ch, w);
    }
    n += w;
  }
  return n;
};

/**
 * Folds a content line at 75 octets, not characters — Arabic is two bytes per
 * character, so a 74-character line is 148 octets and Google Calendar drops it.
 * Continuation lines lose one octet to their leading space.
 */
function fold(line: string): string {
  if (byteLen(line) <= MAX_OCTETS) return line;
  const parts: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = MAX_OCTETS;
  for (const ch of line) {
    const w = byteLen(ch);
    if (curBytes + w > limit) {
      parts.push(cur);
      cur = "";
      curBytes = 0;
      limit = MAX_OCTETS - 1;
    }
    cur += ch;
    curBytes += w;
  }
  if (cur) parts.push(cur);
  return parts.join("\r\n ");
}

const escapeIcs = (s: string) =>
  (s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

const ICS_DAY: Record<number, string> = {
  0: "SU",
  1: "MO",
  2: "TU",
  3: "WE",
  4: "TH",
  5: "FR",
  6: "SA",
};

const icsDate = (d: Date) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;

/** Floating local time, pinned to Egypt time via TZID. */
const icsTime = (d: Date, hhmm: string) =>
  `${icsDate(d)}T${hhmm.replace(":", "")}00`;

/** `DTEND` for an all-day event is exclusive, so it must be the next day. */
const nextDay = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
};

function stamp() {
  return (
    new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
  );
}

/** Builds a recurring weekly .ics covering every lecture and dated event. */
export function buildICS(
  lectures: import("@/lib/db/types").Lecture[] = [],
  events: import("@/lib/db/types").UniversityEvent[] = [],
): string {
  const now = new Date();
  const dtstamp = stamp();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Jadoli//Study Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-TIMEZONE:${TZID}`,
  ];

  // Anchor: the Saturday of the current week. Everything below stays in UTC
  // because icsDate() reads UTC parts — mixing in local setDate() shifted every
  // lecture one day backwards outside UTC.
  const anchor = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  anchor.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 1) % 7));

  lectures.forEach((l) => {
    if (l.day == null || !l.start_time || !l.end_time) return;
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() + ((l.day + 1) % 7));

    const summary = l.subject_name || l.subject_en || "Lecture";
    const description = [
      l.doctor,
      l.kind === "section" ? "تمارين / Section" : "محاضرة / Lecture",
      l.code ? `كود: ${l.code}` : "",
      l.notes,
    ]
      .filter(Boolean)
      .join(" • ");

    lines.push(
      "BEGIN:VEVENT",
      // Stable UID: re-exporting must not create duplicate events.
      fold(`UID:${l.id}@jadoli`),
      fold(`DTSTAMP:${dtstamp}`),
      fold(`DTSTART;TZID=${TZID}:${icsTime(d, l.start_time)}`),
      fold(`DTEND;TZID=${TZID}:${icsTime(d, l.end_time)}`),
      fold(`RRULE:FREQ=WEEKLY;BYDAY=${ICS_DAY[l.day]}`),
      fold(`SUMMARY:${escapeIcs(summary)}`),
    );
    if (l.hall) lines.push(fold(`LOCATION:${escapeIcs(l.hall)}`));
    if (description) lines.push(fold(`DESCRIPTION:${escapeIcs(description)}`));
    lines.push("END:VEVENT");
  });

  events.forEach((e) => {
    if (!e.date) return;
    const d = e.date.replace(/-/g, "");
    const summary = e.title || e.title_en || "Event";
    lines.push(
      "BEGIN:VEVENT",
      fold(`UID:${e.id}@jadoli`),
      fold(`DTSTAMP:${dtstamp}`),
      fold(`DTSTART;VALUE=DATE:${d}`),
      // All-day DTEND is exclusive: the day after.
      fold(`DTEND;VALUE=DATE:${nextDay(e.date)}`),
      fold(`SUMMARY:${escapeIcs(summary)}`),
    );
    if (e.note) lines.push(fold(`DESCRIPTION:${escapeIcs(e.note)}`));
    lines.push("END:VEVENT");
  });

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadICS(
  lectures: import("@/lib/db/types").Lecture[] = [],
  events: import("@/lib/db/types").UniversityEvent[] = [],
  filename = "schedule.ics",
) {
  const blob = new Blob([buildICS(lectures, events)], {
    type: "text/calendar; charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Rasterises a DOM node to a canvas. Loaded lazily to keep the bundle small.
 *
 * modern-screenshot paints through an SVG foreignObject, so the browser computes
 * the colours: html2canvas re-parsed every style in JS and threw on the oklch()
 * and color-mix() colours Tailwind v4 emits, which made the weekly export fail.
 */
export async function nodeToCanvas(node: HTMLElement, scale = 2) {
  const { domToCanvas } = await import("modern-screenshot");
  return domToCanvas(node, {
    backgroundColor: "#ffffff",
    scale,
  });
}

export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string) {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = filename;
  a.click();
}

export async function downloadCanvasPdf(
  canvas: HTMLCanvasElement,
  filename: string,
) {
  const { jsPDF } = await import("jspdf");
  const landscape = canvas.width >= canvas.height;
  const pdf = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "mm",
    format: "a4",
  });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const margin = 6;
  const usableW = pw - margin * 2;
  const usableH = ph - margin * 2;

  // Fit the width to one page, then cut the height into readable slices
  // instead of shrinking a whole week onto a single unreadable sheet.
  const scale = usableW / canvas.width;
  const sliceH = Math.max(1, Math.floor(usableH / scale));
  const pages = Math.max(1, Math.ceil(canvas.height / sliceH));

  for (let page = 0; page < pages; page++) {
    const top = page * sliceH;
    const height = Math.min(sliceH, canvas.height - top);
    if (page > 0) pdf.addPage();

    let dataUrl: string;
    if (pages === 1) {
      dataUrl = canvas.toDataURL("image/png");
    } else {
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = height;
      const ctx = slice.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, top, canvas.width, height, 0, 0, canvas.width, height);
      }
      dataUrl = slice.toDataURL("image/png");
    }

    pdf.addImage(
      dataUrl,
      "PNG",
      margin,
      margin,
      canvas.width * scale,
      height * scale,
    );
  }
  pdf.save(filename);
}
