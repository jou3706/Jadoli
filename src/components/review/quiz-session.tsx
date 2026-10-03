"use client";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mcqCorrectIndex, type QuizQuestion } from "@/lib/ai/schema";

type Outcome = "right" | "wrong" | "reveal";
type Answer = { selected: number | string | null; outcome: Outcome | null };

/**
 * One exam, question by question.
 *
 * Each question keeps its own answer, so moving Back shows what was picked the
 * first time rather than a blank question, and the score is the sum of what has
 * actually been marked. Next and Back are always available: a student who is
 * unsure of one question can come back to it.
 */
export function QuizSession({
  title,
  questions,
  onDone,
}: {
  title?: string;
  questions: QuizQuestion[];
  onDone: () => void;
}) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [finished, setFinished] = useState(false);

  const q = questions[i];
  const answer = answers[i];
  const selected = answer?.selected ?? null;
  const outcome = answer?.outcome ?? null;
  const show = outcome !== null;
  const correctIdx = q && q.type === "mcq" ? mcqCorrectIndex(q) : -1;
  const score = Object.values(answers).filter((a) => a.outcome === "right").length;
  const marked = Object.values(answers).filter((a) => a.outcome !== null).length;

  if (!q) return null;

  if (finished) {
    return (
      <div className="space-y-3 rounded-xl border p-6 text-center">
        <div className="text-lg font-semibold">انتهى الاختبار</div>
        <div className="text-sm">
          نتيجتك: {score} / {questions.length}
        </div>
        <Button onClick={onDone}>عودة</Button>
      </div>
    );
  }

  const select = (v: number | string) => {
    if (show) return;
    setAnswers((p) => ({ ...p, [i]: { selected: v, outcome: null } }));
  };

  const submit = () => {
    let oc: Outcome;
    if (q.type === "mcq") {
      oc = typeof selected === "number" && selected === correctIdx ? "right" : "wrong";
    } else if (q.type === "truefalse") {
      oc = String(selected).toLowerCase() === String(q.answer).toLowerCase() ? "right" : "wrong";
    } else {
      oc = "reveal";
    }
    setAnswers((p) => ({ ...p, [i]: { selected, outcome: oc } }));
  };

  const back = () => setI((n) => Math.max(0, n - 1));
  const next = () => {
    if (i < questions.length - 1) setI(i + 1);
    else setFinished(true);
  };

  const optionClass = (idx: number) => {
    if (!show) return selected === idx ? "border-primary bg-primary/5" : "";
    if (q.type === "mcq" && idx === correctIdx) return "border-emerald-500 bg-emerald-500/10";
    if (selected === idx) return "border-red-500 bg-red-500/10";
    return "opacity-60";
  };

  return (
    <div className="space-y-3 rounded-xl border p-4 text-start">
      {title && <div className="text-sm text-muted-foreground">{title}</div>}
      <div className="text-base font-medium">{q.question}</div>

      {q.type === "mcq" && q.options && (
        <div className="grid gap-2">
          {q.options.map((opt, idx) => (
            <button
              key={idx}
              type="button"
              disabled={show}
              onClick={() => select(idx)}
              className={`rounded-md border px-3 py-2 text-start ${optionClass(idx)}`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {q.type === "truefalse" && (
        <div className="flex gap-2">
          {(["true", "false"] as const).map((v) => (
            <Button
              key={v}
              type="button"
              disabled={show}
              variant={selected === v ? "default" : "outline"}
              onClick={() => select(v)}
            >
              {v === "true" ? "صح" : "خطأ"}
            </Button>
          ))}
        </div>
      )}

      {q.type === "short" && (
        <input
          className="w-full rounded-md border px-2 py-1"
          disabled={show}
          value={typeof selected === "string" ? selected : ""}
          onChange={(e) => select(e.target.value)}
          placeholder="اكتب إجابتك"
        />
      )}

      {outcome === "right" && (
        <div className="flex items-center gap-1.5 rounded-md bg-emerald-500/15 p-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          <Check className="h-4 w-4" /> إجابة صحيحة
        </div>
      )}
      {outcome === "wrong" && (
        <div className="flex items-center gap-1.5 rounded-md bg-red-500/15 p-2 text-sm font-medium text-red-700 dark:text-red-300">
          <X className="h-4 w-4" /> إجابة غلط
        </div>
      )}
      {outcome === "reveal" && (
        <div className="rounded-md bg-muted p-2 text-sm font-medium">الإجابة النموذجية</div>
      )}

      {show && (
        <div className="rounded-md bg-muted p-2 text-sm">
          الإجابة الصحيحة:{" "}
          {q.type === "mcq" && correctIdx >= 0 ? q.options?.[correctIdx] : q.answer}
        </div>
      )}
      {show && q.explanation && (
        <div className="rounded-md border bg-card p-2 text-sm">
          <span className="font-medium">السبب: </span>
          {q.explanation}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={back} disabled={i === 0}>
          السابق
        </Button>
        <div className="text-xs text-muted-foreground">
          {i + 1} / {questions.length}
          {marked > 0 ? ` · ${score} صح` : ""}
        </div>
        {!show ? (
          <Button
            onClick={submit}
            disabled={selected === null || (typeof selected === "string" && selected.trim() === "")}
          >
            تحقق
          </Button>
        ) : (
          <Button onClick={next}>{i < questions.length - 1 ? "التالي" : "إنهاء"}</Button>
        )}
      </div>
    </div>
  );
}
