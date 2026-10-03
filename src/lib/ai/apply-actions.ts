import { getBackend } from "@/lib/db/store";
import { GRADE_SCALE, LECTURE_COLORS } from "@/lib/constants";
import { detectKind, safeUrl } from "@/lib/materials";
import type { AssistantMode } from "./schema";
import type { Grade, Lecture, Material } from "@/lib/db/types";

type Applied = { ok: boolean; label: string };

const HOUR = /^([01]\d|2[0-3]):([0-5]\d)$/;
const pickColor = (i: number) => LECTURE_COLORS[i % LECTURE_COLORS.length];

/** Normalises and validates a lecture payload coming from the model. */
function cleanLecture(
  raw: Record<string, unknown>,
  index: number,
): Partial<Lecture> {
  const subject = String(raw.subject_name ?? "").trim();
  const day = Number(raw.day);
  const start = String(raw.start_time ?? "").trim();
  const end = String(raw.end_time ?? "").trim();
  if (!subject || !Number.isInteger(day) || day < 0 || day > 6) {
    throw new Error(tr("بيانات المحاضرة ناقصة", "Incomplete lecture data"));
  }
  if (!HOUR.test(start) || !HOUR.test(end) || start >= end) {
    throw new Error(tr("وقت المحاضرة غلط", "Invalid lecture time"));
  }
  return {
    subject_name: subject,
    subject_en: String(raw.subject_en ?? "").trim(),
    code: String(raw.code ?? "").trim(),
    doctor: String(raw.doctor ?? "").trim(),
    hall: String(raw.hall ?? "").trim(),
    day,
    start_time: start,
    end_time: end,
    kind: raw.kind === "section" ? "section" : "lecture",
    notes: String(raw.notes ?? "").trim(),
    department: String(raw.department ?? "").trim(),
    color: LECTURE_COLORS.includes(raw.color as never)
      ? String(raw.color)
      : pickColor(index),
  };
}

function cleanGrade(raw: Record<string, unknown>): Partial<Grade> {
  const subject = String(raw.subject_name ?? "").trim();
  const hours = Number(raw.credit_hours);
  const letter = String(raw.letter ?? "").trim().toUpperCase();
  const scale = GRADE_SCALE.find((g) => g.l === letter);
  if (!subject || !scale || !(hours > 0)) {
    throw new Error(tr("بيانات الدرجة ناقصة", "Incomplete grade data"));
  }
  return {
    subject_name: subject,
    code: String(raw.code ?? "").trim(),
    credit_hours: hours,
    letter: scale.l,
    grade_point: scale.p,
    semester: String(raw.semester ?? "").trim(),
  };
}

function cleanMaterial(raw: Record<string, unknown>): Partial<Material> {
  const title = String(raw.title ?? "").trim();
  const url = safeUrl(String(raw.url ?? ""));
  if (!title) {
    throw new Error(tr("المادة محتاجة عنوان", "The material needs a title"));
  }
  if (!url) {
    throw new Error(
      tr("اللينك لازم يبدأ بـ http:// أو https://", "The link must be http(s)"),
    );
  }
  return {
    title: title.slice(0, 200),
    subject_key: String(raw.subject_key ?? "").trim().slice(0, 120),
    url,
    // The stored type is always derived, never taken on trust.
    type: detectKind(url, String(raw.type ?? "")),
  };
}

const tr = (ar: string, en: string) =>
  typeof document !== "undefined" && document.documentElement.dir === "rtl"
    ? ar
    : en;

/**
 * Executes the ```action blocks the assistant emitted. Every action is
 * validated before it touches the database.
 *
 * `mode` is a hard guard, not a hint: in materials mode the schedule and grades
 * are off limits even if the model was talked into emitting those actions.
 */
const ALLOWED: Record<AssistantMode, Set<string>> = {
  general: new Set([
    "add_lecture",
    "update_lecture",
    "delete_lecture",
    "add_grade",
    "delete_grade",
    "add_material",
  ]),
  materials: new Set(["add_material"]),
  quiz: new Set([]),
};

/**
 * Makes sure a subjects row exists for a course name, so a material added by
 * the assistant still shows up as a card with a cover on the subjects page.
 */
async function ensureSubject(name: string) {
  const key = name.trim();
  if (!key) return;
  const subjects = getBackend().table("Subject");
  const existing = await subjects.list();
  if (existing.some((s) => s.name === key)) return;
  await subjects.create({ name: key, image_url: "" });
}

export async function applyActions(
  actions: unknown[],
  mode: AssistantMode = "general",
): Promise<Applied[]> {
  const out: Applied[] = [];
  const db = getBackend();
  const lectures = db.table("Lecture");
  const grades = db.table("Grade");
  const materials = db.table("Material");
  const allowed = ALLOWED[mode];

  for (const raw of actions) {
    try {
      const a = raw as Record<string, unknown>;
      const type = String(a.type ?? "unknown");
      if (!allowed.has(type)) {
        out.push({
          ok: false,
          label:
            mode === "materials"
              ? tr(
                  `${type} مش مسموح في وضع المواد`,
                  `${type} is not allowed in materials mode`,
                )
              : tr(`مش عارف Action: ${type}`, `Unknown action: ${type}`),
        });
        continue;
      }
      switch (type) {
        case "add_lecture": {
          const payload = cleanLecture(
            (a.lecture as Record<string, unknown>) ?? {},
            out.length,
          );
          await lectures.create(payload);
          out.push({ ok: true, label: `+ ${payload.subject_name}` });
          break;
        }
        case "update_lecture": {
          const fields = (a.fields as Record<string, unknown>) ?? {};
          const patch = cleanLecture(
            {
              subject_name: fields.subject_name ?? a.subject_name,
              day: fields.day ?? a.day,
              start_time: fields.start_time ?? a.start_time,
              end_time: fields.end_time ?? a.end_time,
              ...fields,
            },
            0,
          );
          await lectures.update(String(a.id), patch);
          out.push({ ok: true, label: `~ ${patch.subject_name}` });
          break;
        }
        case "delete_lecture": {
          const id = String(a.id);
          // LocalBackend.delete is a no-op for unknown ids, so confirm the row
          // is really there instead of reporting a delete that never happened.
          const existing = await lectures.filter({ id });
          if (!existing.length) throw new Error(tr("المحاضرة مش موجودة", "Lecture not found"));
          await lectures.delete(id);
          out.push({ ok: true, label: `- ${String(id).slice(0, 8)}` });
          break;
        }
        case "add_grade": {
          const payload = cleanGrade((a.grade as Record<string, unknown>) ?? {});
          await grades.create(payload);
          out.push({ ok: true, label: `+ ${payload.subject_name}` });
          break;
        }
        case "delete_grade": {
          const id = String(a.id);
          const existing = await grades.filter({ id });
          if (!existing.length) throw new Error(tr("الدرجة مش موجودة", "Grade not found"));
          await grades.delete(id);
          out.push({ ok: true, label: `- ${String(id).slice(0, 8)}` });
          break;
        }
        case "add_material": {
          const payload = cleanMaterial((a.material as Record<string, unknown>) ?? {});
          await materials.create(payload);
          // Keep a subjects row for every course that has a material, so the
          // subjects page can show its cover tile for it.
          if (payload.subject_key) await ensureSubject(payload.subject_key);
          out.push({ ok: true, label: `+ ${payload.title}` });
          break;
        }
        default:
          out.push({
            ok: false,
            label: `? ${String(a.type ?? "unknown")}`,
          });
      }
    } catch (e) {
      out.push({ ok: false, label: (e as Error).message });
    }
  }
  return out;
}
