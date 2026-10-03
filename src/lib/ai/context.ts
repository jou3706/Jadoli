import { dayName, type Lang } from "@/lib/constants";
import { isoDate } from "@/lib/utils";
import type { AssistantMode } from "./schema";
import type { Grade, Lecture, Material, UniversityEvent } from "@/lib/db/types";

export type StudentData = {
  lectures: Lecture[];
  grades: Grade[];
  events: UniversityEvent[];
  materials: Material[];
  now: Date;
  lang: Lang;
  mode?: AssistantMode;
};

const nowLine = (now: Date) =>
  `now: ${isoDate(now)} ${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")} (weekday id ${now.getDay()}, Cairo)`;

/** The course names a material could belong to, so the model can match them. */
function courseList(lectures: Lecture[], materials: Material[]): string[] {
  const seen = new Map<string, string>();
  for (const l of lectures) {
    const name = (l.subject_name || "").trim();
    if (name) seen.set(name.toLowerCase(), name);
  }
  for (const m of materials) {
    const name = (m.subject_key || "").trim();
    if (name) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()];
}

/**
 * Compact snapshot of the student's data, prepended to the question so the
 * assistant can ground its answers. The system prompt is server-only and cannot
 * be changed from the browser, so the context rides along with the turn.
 */
export function buildContext(data: StudentData): string {
  const { lectures, grades, events, materials, now, lang, mode } = data;

  // Quiz mode: provide subjects and materials organized by subject
  if (mode === "quiz") {
    const L: string[] = [nowLine(now), "", "mode: quiz"];
    const by = new Map<string, Material[]>();
    for (const m of materials) {
      const k = (m.subject_key || "").trim();
      if (!k) continue;
      const lst = by.get(k) ?? [];
      lst.push(m);
      by.set(k, lst);
    }
    L.push("", "subjects_with_materials:");
    if (by.size) {
      for (const [sk, lst] of by) {
        L.push("- " + sk + " (" + lst.length + ")");
      }
    } else {
      L.push("(none)");
    }
    L.push("", "materials:");
    if (materials.length) {
      for (const m of materials) {
        L.push("- id=" + m.id + " | subject=" + (m.subject_key || "(unassigned)") + " | title=" + m.title + " | type=" + (m.type || "unknown") + " | url=" + m.url);
      }
    } else {
      L.push("(none saved yet)");
    }
    return L.join("\n");
  }

  // Materials mode: the timetable, grades and events are not injected at all,
  // so the model cannot answer from them even if the student insists.
  if (mode === "materials") {
    const L: string[] = [nowLine(now), "", "mode: materials"];
    const courses = courseList(lectures, materials);
    L.push("", "courses:");
    if (courses.length) for (const c of courses) L.push(`- ${c}`);
    else L.push("(none)");

    L.push("", "materials:");
    if (materials.length) {
      for (const m of materials) {
        L.push(
          `- ${m.title}${m.subject_key ? ` | course: ${m.subject_key}` : ""}` +
            `${m.type ? ` | ${m.type}` : ""} | ${m.url} | id=${m.id}`,
        );
      }
    } else {
      L.push("(none saved yet)");
    }
    return L.join("\n");
  }

  const L: string[] = [nowLine(now), "", "mode: general"];

  if (lectures.length) {
    L.push("", "lectures:");
    for (const l of lectures) {
      L.push(
        `- ${l.subject_name}${l.subject_en ? ` / ${l.subject_en}` : ""}` +
          `${l.code ? ` [${l.code}]` : ""} | day=${l.day} (${
            dayName(Number(l.day), lang)
          }) | ${l.start_time}-${l.end_time}` +
          `${l.hall ? ` | hall=${l.hall}` : ""}${l.doctor ? ` | doctor=${l.doctor}` : ""}` +
          `${l.kind === "section" ? " | kind=section" : ""}` +
          `${l.notes ? ` | notes=${l.notes}` : ""} | id=${l.id}`,
      );
    }
  } else {
    L.push("", "lectures: (none saved yet)");
  }

  if (grades.length) {
    let points = 0;
    let hours = 0;
    L.push("", "grades:");
    for (const g of grades) {
      const h = Number(g.credit_hours) || 0;
      points += h * (Number(g.grade_point) || 0);
      hours += h;
      L.push(
        `- ${g.subject_name} | letter=${g.letter} | points=${g.grade_point} | hours=${h}` +
          `${g.semester ? ` | ${g.semester}` : ""} | id=${g.id}`,
      );
    }
    L.push(`cumulative_gpa: ${hours ? (points / hours).toFixed(2) : "0.00"}`);
  }

  const today = isoDate(now);
  const soon = events
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 25);
  if (soon.length) {
    L.push("", "upcoming_events:");
    for (const e of soon) {
      L.push(
        `- ${e.date} | ${e.type} | ${e.title}${e.title_en ? ` / ${e.title_en}` : ""}` +
          `${e.note ? ` | ${e.note}` : ""}`,
      );
    }
  }

  if (materials.length) {
    L.push("", "materials:");
    for (const m of materials.slice(0, 40)) {
      L.push(
        `- ${m.title}${m.subject_key ? ` | course: ${m.subject_key}` : ""}` +
          `${m.type ? ` | ${m.type}` : ""} | ${m.url} | id=${m.id}`,
      );
    }
  }

  return L.join("\n");
}

/** Prepends context to the first turn only, so it isn't resent every message. */
export function withContext(question: string, context: string) {
  return `<student_data>\n${context}\n</student_data>\n\n${question}`;
}
