import { isUniqueViolation } from "./db/errors";
import { newCardState } from "./srs";
import type { Flashcard } from "./db/types";

/**
 * Turning generated cards into rows, and deciding whether to keep them.
 *
 * Nothing here trusts the model. A card is a question and an answer written by
 * something that was asked to write JSON, so the checks are about the two ways
 * that goes wrong: a card with no question, which is a card nobody can be asked,
 * and the same card twice, which is a queue that doubles for no reason.
 *
 * The scheduling fields are filled from one place - `newCardState` - so a saved
 * card and a card being reviewed cannot disagree about when it is next due.
 */

/** A card as it comes back from the model, before it has a home. */
export type GeneratedCard = {
  question: string;
  answer: string;
};

export type CardDraft = GeneratedCard & {
  /** Set when the card was dropped, and why. Shown, not swallowed. */
  dropped?: string;
};

const MAX_QUESTION = 300;
const MAX_ANSWER = 600;

/**
 * Cleans a model's cards and says what it threw away.
 *
 * Returns the kept cards and the rejects, rather than just the kept ones: a
 * student who asked for ten cards and got seven is owed the reason, and the
 * reason is usually "the notes only had seven" or "one had no answer".
 */
export function cleanGeneratedCards(
  raw: unknown[],
  opts: { limit?: number } = {},
): { cards: GeneratedCard[]; dropped: CardDraft[] } {
  const limit = opts.limit ?? 40;
  const cards: GeneratedCard[] = [];
  const dropped: CardDraft[] = [];
  const seen = new Set<string>();

  for (const row of raw) {
    const r = (row ?? {}) as Record<string, unknown>;
    const question = String(r.question ?? r.q ?? r.front ?? "").trim();
    const answer = String(r.answer ?? r.a ?? r.back ?? "").trim();

    if (!question && !answer) {
      dropped.push({ question, answer, dropped: "empty" });
      continue;
    }
    if (!question) {
      dropped.push({ question, answer, dropped: "no question" });
      continue;
    }
    if (!answer) {
      dropped.push({ question, answer, dropped: "no answer" });
      continue;
    }
    // The same question twice is one card asked twice, which is the queue's
    // whole problem and not the student's.
    const fingerprint = question.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(fingerprint)) {
      dropped.push({ question, answer, dropped: "repeated" });
      continue;
    }
    seen.add(fingerprint);
    if (cards.length >= limit) {
      dropped.push({ question, answer, dropped: "over the limit" });
      continue;
    }
    cards.push({
      question: question.slice(0, MAX_QUESTION),
      answer: answer.slice(0, MAX_ANSWER),
    });
  }

  return { cards, dropped };
}

/**
 * A row for one generated card.
 *
 * A new card is due today and has never been seen: no interval, no history, and
 * the standard ease. Written here rather than in the dialog so that saving from
 * one place and saving from another cannot produce two different cards.
 */
export function flashcardPayload(
  card: GeneratedCard,
  meta: {
    subject: string;
    source: string;
    sourceKind?: Flashcard["source_kind"];
    language?: Flashcard["language"];
    today: string;
  },
): Partial<Flashcard> {
  return {
    subject_key: meta.subject.trim(),
    question: card.question.trim(),
    answer: card.answer.trim(),
    source: meta.source.trim().slice(0, 200),
    source_kind: meta.sourceKind ?? "typed",
    language: meta.language ?? "ar",
    ...newCardState(meta.today),
  };
}

/**
 * Whether the server refused the card because it is already there.
 *
 * The unique index is on course plus question, so this is the answer when a
 * student regenerates the same notes twice — which is the normal way to find out
 * whether the first batch was any good.
 */
export const isDuplicateCard = (err: unknown) => isUniqueViolation(err);

/** How many of the drops are worth mentioning. */
export function summariseDrops(dropped: CardDraft[]) {
  const byReason = new Map<string, number>();
  for (const d of dropped) {
    byReason.set(d.dropped ?? "other", (byReason.get(d.dropped ?? "other") ?? 0) + 1);
  }
  return [...byReason.entries()].map(([reason, count]) => ({ reason, count }));
}

/**
 * What to call a drop, in the app's two languages.
 *
 * Only the reasons a student can act on get words here; anything else is noise
 * on a screen that is already showing them a queue.
 */
export const dropReasonLabel = (reason: string, lang: "ar" | "en") => {
  const table: Record<string, [string, string]> = {
    empty: ["فاضي", "empty"],
    "no question": ["من غير سؤال", "no question"],
    "no answer": ["من غير إجابة", "no answer"],
    repeated: ["مكرر", "repeated"],
    "over the limit": ["أكتر من المطلوب", "over the limit"],
  };
  const found = table[reason];
  if (!found) return lang === "en" ? "skipped" : "اتخطى";
  return lang === "en" ? found[1] : found[0];
};