import { z } from "zod";
import { extractJson } from "./extract";

const turn = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(20_000),
});

const image = z.object({
  dataUrl: z
    .string()
    .regex(/^data:(image\/(png|jpe?g|webp|gif)|application\/pdf);base64,[A-Za-z0-9+/=]+$/, {
      message: "attachment must be a base64 data URL",
    })
    .max(20_000_000),
  mime: z.string().max(60),
});

/** True when the provider/model can actually read this attachment. */
export const attachmentKind = (mime: string) =>
  mime === "application/pdf" ? "pdf" : "image";

/** Which slice of the student's data the assistant is allowed to use. */
export const ASSISTANT_MODES = ["general", "materials", "quiz"] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];

export const chatBodySchema = z.object({
  model: z.string().min(1).max(60),
  question: z.string().min(1).max(8000),
  mode: z.enum(ASSISTANT_MODES).default("general"),
  history: z.array(turn).max(40).default([]),
  images: z.array(image).max(6).default([]),
});

/**
 * Importing a timetable is reading a photograph, so the model is never chosen
 * here: it is whatever can see, which is the route's decision.
 */
export const importBodySchema = z.object({
  images: z.array(image).min(1).max(8),
});

/**
 * Enough to make cards from, and no more than a model will read.
 *
 * Either typed notes or a file, or both. The text is capped rather than the
 * images because a wall of pasted text is the failure that costs money without
 * producing cards, and the honest answer to it is "that is a lot of notes, save
 * it as a material and make cards from the lecture".
 */
export const MAX_NOTE_CHARS = 12_000;

/** Mirrors `MAX_CARDABLE_MATERIALS` in `lib/material-cards`. */
export const MAX_MATERIAL_PARTS = 6;

/** The student decides the card count; this is the most one request may ask for. */
export const MIN_FLASHCARDS = 3;
/** Mirrored by the review dialog's free number input, so a higher ceiling here
 *  would tell the model something the screen will not let the student ask. */
export const MAX_FLASHCARDS = 40;

/** The student picks the exam size; the request schema and the checker share
 *  this one ceiling, so a lower number in one of them would silently refuse
 *  what the other advertises. */
export const MIN_QUIZ_QUESTIONS = 3;
export const MAX_QUIZ_QUESTIONS = 100;

/**
 * Quiz generation: where the questions come from.
 *
 * `materialIds` is a list, not a single id: the student picks every file of the
 * course they want the exam drawn from, and the route reads them all server-side.
 */
export const quizSourceSchema = z
  .object({
    subjectKey: z.string().trim().min(1),
    source: z.enum(["material", "chapter", "topic"]).default("material"),
    /** Saved materials to read; one or more. */
    materialIds: z.array(z.string().min(1).max(64)).max(MAX_MATERIAL_PARTS).default([]),
    chapter: z.string().trim().min(1).optional(),
    topic: z.string().trim().min(1).optional(),
    count: z.number().int().min(MIN_QUIZ_QUESTIONS).max(MAX_QUIZ_QUESTIONS).default(10),
    language: z.enum(["auto", "ar", "en"]).default("auto"),
  })
  .superRefine((v, ctx) => {
    if (v.source === "material" && v.materialIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "choose at least one material",
        path: ["materialIds"],
      });
    }
    if (v.source === "chapter" && !v.chapter) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "chapter required", path: ["chapter"] });
    }
    if (v.source === "topic" && !v.topic) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "topic required", path: ["topic"] });
    }
  });

export type QuizSource = z.infer<typeof quizSourceSchema>;

/**
 * Quiz question types
 */
export const quizQuestionSchema = z.object({
  type: z.enum(["mcq", "truefalse", "short"]).default("mcq"),
  question: z.string().min(1),
  options: z.array(z.string()).optional(),
  answer: z.string().min(1),
  explanation: z.string().optional(),
});

export const quizSetSchema = z.object({
  title: z.string().optional(),
  questions: z.array(quizQuestionSchema).min(1).max(MAX_QUIZ_QUESTIONS),
});

export type QuizQuestion = z.infer<typeof quizQuestionSchema>;
export type QuizSet = z.infer<typeof quizSetSchema>;

/**
 * Index of the correct MCQ option.
 *
 * Accepts the exact option text, a letter ("A"–"D") or a 1-based number, because
 * models drift between them and a quiz that cannot mark the right answer is
 * worse than no quiz.
 */
export function mcqCorrectIndex(q: QuizQuestion): number {
  if (!q.options || q.options.length === 0) return -1;
  const ans = q.answer.trim();
  const byText = q.options.findIndex((o) => o.trim() === ans);
  if (byText >= 0) return byText;
  if (ans.length === 1) {
    const li = "ABCDEFGH".indexOf(ans.toUpperCase());
    if (li >= 0 && li < q.options.length) return li;
  }
  const num = Number(ans);
  if (Number.isInteger(num) && num >= 1 && num <= q.options.length) return num - 1;
  return -1;
}

/** Pulls a quiz out of model output: bare JSON, a ```json fence, or JSON in prose. */
export function parseQuiz(text: string): QuizSet | null {
  // The balanced extractor first: it reads fences, leading prose and a trailing
  // sentence in one pass, and understands braces inside a quoted answer.
  const direct = quizSetSchema.safeParse(extractJson(text));
  if (direct.success) return direct.data;
  const candidates = [text.trim()];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) candidates.push(m[1].trim());
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const c of candidates) {
    if (!c) continue;
    try {
      const parsed = quizSetSchema.safeParse(JSON.parse(c));
      if (parsed.success) return parsed.data;
    } catch {
      /* not JSON: try the next candidate */
    }
  }
  return null;
}

/**
 * One file to read, named so the model can be told which question came from
 * which page.
 *
 * A `file_path` and not the bytes. The deployment caps a request body at 4.5 MB,
 * and base64 makes a file a third bigger, so a lecture PDF sent from the browser
 * is refused before the model is ever reached - by the platform, with an
 * error that arrives as plain text, which the dialog now reads as text rather
 * than assuming JSON.
 */
export const materialRef = z.object({
  id: z.string().min(1).max(64),
  /** Storage path, sent for convenience; the route verifies it against the row. */
  file_path: z.string().max(300).default(""),
  title: z.string().max(200).default(""),
});

export const flashcardsBodySchema = z
  .object({
    /** The course these cards belong to. */
    subject: z.string().max(120).default(""),
    /** Notes typed or pasted by the student. */
    text: z.string().max(MAX_NOTE_CHARS).default(""),
    /** Files already saved as materials on the course. */
    materials: z.array(materialRef).max(MAX_MATERIAL_PARTS).default([]),
    /** How many cards to ask for. A hint, not a promise. */
    count: z.number().int().min(MIN_FLASHCARDS).max(MAX_FLASHCARDS).default(10),
    language: z.enum(["ar", "en"]).default("ar"),
  })
  .refine((v) => v.text.trim().length > 0 || v.materials.length > 0, {
    message: "there is nothing to make cards from",
    path: ["text"],
  });

/** Strips a leading ```action ...``` block out of a reply. */
export function splitAction(reply: string): {
  visible: string;
  actions: unknown[];
} {
  const re = /```action\s*\n([\s\S]*?)```/g;
  const actions: unknown[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) actions.push(...parsed);
      else actions.push(parsed);
    } catch {
      /* skip malformed action */
    }
  }
  const visible = reply
    .replace(/```action\s*\n[\s\S]*?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { visible, actions: actions.filter((a) => a && typeof a === "object") };
}
