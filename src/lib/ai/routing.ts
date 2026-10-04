import { DEFAULT_MODEL, findModel, type ModelId } from "./models";

/**
 * Which model answers which background job.
 *
 * The student picks a model for chat and nothing else — they are answering a
 * question they asked, and they are entitled to choose who answers it. These
 * are jobs nobody chose a model for: the app decided to do them, so the app
 * should pick an answerer.
 *
 * Text-only work goes to the text-only pools. They are quicker, and leaving
 * Gemini's quota for the jobs that genuinely need to read a page is what keeps
 * the app answering when Gemini is busy.
 */
export type AiTask = "quiz" | "flashcards" | "import" | "chat";

const TEXT_TASK_MODEL: Record<AiTask, ModelId> = {
  // A quiz is only worth the trouble if the marked answers are right, and that
  // is the one job where the bigger model earns its keep.
  quiz: DEFAULT_MODEL,
  // Cards are mechanical once the notes are read: many short pairs, one shape,
  // nothing subtle. The fastest pool does this better than a careful one.
  flashcards: "groq-20b",
  // Importing a timetable means reading a photograph, so this never gets here
  // without an attachment and is always answered by a vision model.
  import: DEFAULT_MODEL,
  // Chat is the student's own choice; this is only the fallback for it.
  chat: DEFAULT_MODEL,
};

/**
 * The model for a job, given what it has to read.
 *
 * Anything carrying an attachment goes to a model that can open it, whatever the
 * task would otherwise have used.
 */
export function taskModel(task: AiTask, hasAttachments: boolean): ModelId {
  return hasAttachments ? DEFAULT_MODEL : TEXT_TASK_MODEL[task];
}

/**
 * The model that checks the answer key, given the one that wrote it.
 *
 * Always a different provider, on purpose. A model asked to check its own work
 * agrees with itself; the mistakes worth catching here — a plausible wrong
 * answer marked right — are the ones a model repeats when asked twice. Switching
 * provider also means the checker cannot be rate-limited by the same quota as
 * the exam it is checking.
 *
 * Text-only on purpose too: the checker is shown the questions and the marked
 * answers, not the material, so it never has to open a file.
 */
export function verifierFor(primary: ModelId): ModelId {
  return findModel(primary).provider === "gemini" ? "groq-120b" : DEFAULT_MODEL;
}