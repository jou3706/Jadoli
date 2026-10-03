import { z } from "zod";

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

export const importBodySchema = z.object({
  model: z.string().min(1).max(60).default("gemini-35-flash"),
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

/**
 * Quiz generation: source of content for generating questions.
 */
export const quizSourceSchema = z
  .object({
    subjectKey: z.string().trim().min(1),
    source: z.enum(["material", "chapter", "topic"]).default("material"),
    materialId: z.string().uuid().optional(),
    materialTitle: z.string().trim().optional(),
    materialFilePath: z.string().trim().optional(),
    chapter: z.string().trim().optional(),
    topic: z.string().trim().min(1).optional(),
    count: z.number().int().min(3).max(20).default(10),
    language: z.enum(["ar", "en"]).default("ar"),
  })
  .superRefine((v, ctx) => {
    if (v.source === "material") {
      if (!v.materialId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "material required", path: ["materialId"] });
      }
    }
    if (v.source === "chapter") {
      if (!v.chapter || v.chapter.length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "chapter required", path: ["chapter"] });
      }
    }
    if (v.source === "topic") {
      if (!v.topic || v.topic.length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "topic required", path: ["topic"] });
      }
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
  questions: z.array(quizQuestionSchema).min(1).max(30),
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

/** Mirrors `MAX_CARDABLE_MATERIALS` in `lib/material-cards`. */
export const MAX_MATERIAL_PARTS = 6;

export const flashcardsBodySchema = z
  .object({
    model: z.string().min(1).max(60).default("gemini-35-flash"),
    /** The course these cards belong to. */
    subject: z.string().max(120).default(""),
    /** Notes typed or pasted by the student. */
    text: z.string().max(MAX_NOTE_CHARS).default(""),
    /** Files already saved as materials on the course. */
    materials: z.array(materialRef).max(MAX_MATERIAL_PARTS).default([]),
    /** How many cards to ask for. A hint, not a promise. */
    count: z.number().int().min(3).max(40).default(10),
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
