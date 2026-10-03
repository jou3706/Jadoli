import type { QuizQuestion } from "./ai/schema";
import type { Question } from "./db/types";

/**
 * The question bank: turning generated questions into rows, without ever writing
 * the same one twice.
 *
 * A question shown to a student stays shown, so the bank is the record of what
 * the app has already asked. The identity of a question is its course plus its
 * text — the same rule the unique index enforces at the database — so asking the
 * model for an exam twice adds only what is actually new.
 */

/** Normalised identity of one question: course plus the question text. */
export function questionKey(subjectKey: string, question: string): string {
  const subject = subjectKey.trim().toLowerCase();
  const text = question.trim().replace(/\s+/g, " ").toLowerCase();
  return `${subject}\u0000${text}`;
}

/**
 * The incoming questions the bank does not already hold.
 *
 * Drops repeats inside the incoming batch as well as ones already saved, and
 * drops anything with no question text, because a blank row is not a question.
 */
export function newQuestions(
  incoming: QuizQuestion[],
  existing: Pick<Question, "subject_key" | "question">[],
  subjectKey: string,
): QuizQuestion[] {
  const seen = new Set(existing.map((e) => questionKey(e.subject_key, e.question)));
  const fresh: QuizQuestion[] = [];
  for (const q of incoming) {
    if (!q.question.trim()) continue;
    const key = questionKey(subjectKey, q.question);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(q);
  }
  return fresh;
}

/** A row for one generated question. */
export function questionPayload(
  q: QuizQuestion,
  meta: { subjectKey: string; source: string },
): Partial<Question> {
  return {
    subject_key: meta.subjectKey.trim(),
    question: q.question.trim().slice(0, 500),
    type: q.type,
    options: (q.options ?? []).map((o) => o.trim()).filter(Boolean),
    answer: q.answer.trim().slice(0, 1000),
    explanation: (q.explanation ?? "").trim().slice(0, 1000),
    source: meta.source.trim().slice(0, 200),
  };
}
