import { NextResponse } from "next/server";
import { importBodySchema } from "@/lib/ai/schema";
import { extractArray } from "@/lib/ai/extract";
import { completeJson } from "@/lib/ai/providers";
import { IMPORT_SYSTEM } from "@/lib/ai/prompts";
import { taskModel } from "@/lib/ai/routing";

export const runtime = "nodejs";
export const maxDuration = 90;

const DAY_NAMES: Record<string, number> = {
  saturday: 6, sat: 6, satur: 6,
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
};

const normTime = (v: unknown): string | null => {
  const m = String(v ?? "")
    .trim()
    .match(/^(\d{1,2})\s*[:.\-]?\s*(\d{2})?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = m[2] ? Number(m[2]) : 0;
  const ampm = m[3]?.toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
};

const normDay = (v: unknown): number | null => {
  if (typeof v === "number" && v >= 0 && v <= 6) return v;
  const s = String(v ?? "").toLowerCase().trim();
  if (s in DAY_NAMES) return DAY_NAMES[s];
  const m = s.match(/^([a-z]{3,9})/);
  if (m && m[1] in DAY_NAMES) return DAY_NAMES[m[1]];
  return null;
};

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = importBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const { images } = parsed.data;
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  let raw: string;
  try {
    raw = await completeJson(
      taskModel("import", true),
      IMPORT_SYSTEM,
      images.length === 1
        ? "Extract the timetable from this image."
        : `Extract the timetable from these ${images.length} images, in order. Merge into one list.`,
      images.map((i) => ({ dataUrl: i.dataUrl, mime: i.mime })),
      ac.signal,
    );
  } catch (e) {
    const err = e as Error;
    return NextResponse.json(
      { error: err.message || "Could not read the file" },
      { status: 502 },
    );
  }

  const lectures = extractArray(raw)
    .map((row, i) => {
      const r = row as Record<string, unknown>;
      const start = normTime(r.start_time ?? r.start ?? r.from);
      const end = normTime(r.end_time ?? r.end ?? r.to);
      const day = normDay(r.day ?? r.weekday);
      const subject = String(r.subject_name ?? r.subject ?? r.name ?? "").trim();
      if (!subject || !start || !end || day === null) return null;
      if (start >= end) return null;
      return {
        subject_name: subject,
        subject_en: String(r.subject_en ?? r.subject_english ?? ""),
        code: String(r.code ?? ""),
        doctor: String(r.doctor ?? r.lecturer ?? r.professor ?? ""),
        hall: String(r.hall ?? r.room ?? r.place ?? ""),
        day,
        start_time: start,
        end_time: end,
        kind: r.kind === "section" ? "section" : "lecture",
        notes: String(r.notes ?? ""),
        department: String(r.department ?? "عامة"),
        color: `__auto_${i}`,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ lectures });
}
