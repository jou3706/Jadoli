"use client";

import { useMemo, useState } from "react";
import { Eye } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useMutate } from "@/lib/db/store";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  gradeCard,
  previewGrades,
  type ReviewGrade,
  type SrsCard,
} from "@/lib/srs";

/**
 * The actual revision: one card, the answer hidden, and four honest buttons.
 *
 * The order of the screen is the order of the thinking. The question is read
 * first, because reading the answer before the question is what turns review
 * into reading. The buttons carry the date each one would set, because "did I
 * get it?" is a bad enough answer on its own - somebody who is unsure needs to
 * see that "hard" means seeing it tomorrow, and decide against "easy" because
 * of that.
 *
 * A card is written back the moment it is answered, not at the end of the
 * sitting. A sitting closed by a lost phone or a tab closed is a sitting where
 * the first hour's work was thrown away, and there is no way to tell afterwards
 * which hour was which.
 */
export function Reviewer({
  cards,
  today,
  onFinished,
}: {
  /** The queue for this sitting, already ordered. */
  cards: SrsCard[];
  today: string;
  onFinished: (answered: number) => void;
}) {
  const { tr } = useI18n();
  const toast = useToast();
  const { update } = useMutate("Flashcard");
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);

  const card = cards[index];
  const state = useMemo(
    () =>
      card
        ? {
            interval_days: card.interval_days,
            ease: card.ease,
            reps: card.reps,
            lapses: card.lapses,
            due_date: card.due_date,
            last_review: card.last_review,
          }
        : null,
    [card],
  );
  const choices = useMemo(
    () => (state ? previewGrades(state, today) : []),
    [state, today],
  );

  if (!card || !state) {
    return (
      <div className="rounded-2xl border p-6 text-center">
        <p className="font-heading text-lg font-bold">
          {tr("خلصت القعدة", "That is the lot")}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {tr(
            "اللي بعده هيتبان النهاردة الأول.",
            "The rest comes back another day.",
          )}
        </p>
      </div>
    );
  }

  const move = () => {
    setRevealed(false);
    if (index + 1 >= cards.length) onFinished(answered);
    else setIndex(index + 1);
  };

  const answer = async (grade: ReviewGrade) => {
    setSaving(true);
    try {
      const next = gradeCard(state, grade, today);
      await update(card.id, {
        interval_days: next.interval_days,
        ease: next.ease,
        reps: next.reps,
        lapses: next.lapses,
        due_date: next.due_date,
        last_review: next.last_review,
      });
      setAnswered(answered + 1);
      move();
    } catch (e) {
      toast({
        title: tr("مش قادرين نحفظ الإجابة", "Could not save that answer"),
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span className="tabular-nums">
          {index + 1} / {cards.length}
        </span>
        <span className="truncate">{card.subject_key || tr("كل المواد", "All courses")}</span>
      </div>

      <div className="rounded-2xl border p-5">
        <p className="font-heading text-lg font-bold leading-relaxed">{card.question}</p>

        {revealed ? (
          <p className="mt-4 border-t pt-4 text-base leading-relaxed text-muted-foreground">
            {card.answer}
          </p>
        ) : (
          <div className="mt-4 border-t pt-4">
            <Button variant="outline" className="w-full gap-2" onClick={() => setRevealed(true)}>
              <Eye className="h-4 w-4" /> {tr("شوف الإجابة", "Show the answer")}
            </Button>
          </div>
        )}
      </div>

      {revealed ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              disabled={saving}
              onClick={() => answer(choice.id)}
              className={cn(
                "rounded-xl border px-3 py-3 text-center transition-transform active:scale-95",
                "disabled:opacity-50",
                choice.cls,
              )}
            >
              <span className="block font-heading font-bold">{tr(choice.ar, choice.en)}</span>
              <span className="mt-0.5 block text-[11px] opacity-80">
                {tr(
                  choice.interval_days <= 0 ? "النهارده" : `${choice.interval_days} يوم`,
                  choice.interval_days <= 0 ? "today" : `${choice.interval_days}d`,
                )}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          {tr("قري الإجابة الأول، بعدها اختار", "Read the answer, then choose")}
        </p>
      )}

      {answered > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          {tr(`اتجابت على ${answered} كارت`, `${answered} answered so far`)}
        </p>
      )}
    </div>
  );
}