import { extractJson } from "./extract";
import type { QuizQuestion, QuizSet } from "./schema";

/**
 * The second opinion on an answer key.
 *
 * Kept free of the provider on purpose: the interesting part is not the call,
 * it is deciding what to do with what came back. A checker is another model that
 * can be wrong in a different direction, so nothing here is trusted except a
 * correction that names an answer the question could actually have.
 */

export type QuizFix = { index: number; answer: string };

/**
 * The exam as the checker sees it: questions, options, and the marked answer.
 *
 * Numbering is explicit and answers are shown in full, because the whole job is
 * comparing them against each other.
 */
export function verdictInput(set: QuizSet): string {
  return set.questions
    .map((q, i) => {
      const lines = [`${i}. [${q.type}] ${q.question}`];
      if (q.options?.length) {
        lines.push(`options: ${q.options.map((o) => `- ${o}`).join("\n")}`);
      }
      lines.push(`marked answer: ${q.answer}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * The corrections in a checker reply, or nothing if it said something unusable.
 *
 * Models answer this prompt well, which means they mostly answer it slightly
 * differently: `fixes` or `corrections`, `i` or `index`, wrapped or bare. Being
 * forgiving about the shape is worth it here; a reply in an unexpected shape is
 * a missed catch, and a throw here would cost the student the whole exam.
 */
export function parseVerdict(raw: string): QuizFix[] {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object") return [];

  const asRecord = parsed as Record<string, unknown>;
  const wrapped = [asRecord.fixes, asRecord.corrections, asRecord.changes, asRecord.wrong];
  const list = Array.isArray(parsed)
    ? parsed
    : wrapped.find((v): v is unknown[] => Array.isArray(v));
  if (!list) return [];

  const fixes: QuizFix[] = [];
  const seen = new Set<number>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const index = Number(rec.i ?? rec.index ?? rec.n ?? rec.question_index);
    const answer = String(rec.answer ?? rec.correct ?? rec.correctAnswer ?? "").trim();
    if (!Number.isInteger(index) || index < 0 || !answer) continue;
    if (seen.has(index)) continue; // a question only has one answer
    seen.add(index);
    fixes.push({ index, answer });
  }
  return fixes;
}

/**
 * The corrected answer, but only if this question could actually have it.
 *
 * This is the guard that makes a second opinion safe to apply: the replacement
 * has to be one of the question's own options, or exactly `true`/`false`. A
 * checker that paraphrases, invents, or answers a question that had no options
 * to choose from is ignored rather than believed.
 */
function correctedAnswer(q: QuizQuestion, proposed: string): string | null {
  const want = proposed.trim().toLowerCase().replace(/\s+/g, " ");
  if (q.type === "truefalse") {
    if (want === "true") return "true";
    if (want === "false") return "false";
    return null;
  }
  if (q.type !== "mcq" || !q.options?.length) return null;
  return q.options.find((o) => o.trim().toLowerCase() === want) ?? null;
}

/**
 * The exam with the checker's corrections folded in.
 *
 * Corrections are ignored outright if there are more of them than half the
 * questions: that is not a checker disagreeing with a writer, it is a checker
 * that read the wrong exam, and applying it would replace an answer key with a
 * different one rather than fix one.
 *
 * The count comes back alongside because it is worth knowing: an exam that
 * arrived with three corrections was checked harder than one that came back
 * clean.
 */
export function applyFixes(
  set: QuizSet,
  fixes: QuizFix[],
): { set: QuizSet; applied: number } {
  if (fixes.length > set.questions.length / 2) return { set, applied: 0 };

  const proposed = new Map<number, string>();
  for (const f of fixes) {
    if (!proposed.has(f.index)) proposed.set(f.index, f.answer);
  }

  let applied = 0;
  const questions = set.questions.map((q, i) => {
    const suggestion = proposed.get(i);
    if (suggestion === undefined) return q;
    const corrected = correctedAnswer(q, suggestion);
    if (corrected === null || corrected === q.answer) return q;
    applied += 1;
    return { ...q, answer: corrected };
  });

  return { set: applied ? { ...set, questions } : set, applied };
}