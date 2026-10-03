"use client";
import { useMemo, useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList, useMutate } from "@/lib/db/store";
import { Button } from "@/components/ui/button";
import type { Question } from "@/lib/db/types";

const TYPE_LABEL: Record<Question["type"], [string, string]> = {
  mcq: ["اختيار من متعدد", "Multiple choice"],
  truefalse: ["صح/خطأ", "True / false"],
  short: ["إجابة قصيرة", "Short answer"],
};

/**
 * The question bank.
 *
 * Every question the app has shown, grouped by course, with its answer and the
 * reason it is right. It is a reading list first and a place to delete second:
 * one course plus one question is one row, so the same question never piles up.
 */
export default function QuestionsPage() {
  const { tr } = useI18n();
  const { data: questions = [], isLoading } = useList("Question", "-created_date", 2000);
  const { remove } = useMutate("Question");
  const [needle, setNeedle] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const groups = useMemo(() => {
    const q = needle.trim().toLowerCase();
    const map = new Map<string, Question[]>();
    for (const item of questions) {
      if (
        q &&
        !item.question.toLowerCase().includes(q) &&
        !(item.subject_key ?? "").toLowerCase().includes(q)
      ) {
        continue;
      }
      const key = (item.subject_key || "").trim() || tr("بدون مادة", "No course");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [questions, needle, tr]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{tr("بنك الأسئلة", "Question bank")}</h1>
        <span className="text-sm text-muted-foreground">
          {tr(`${questions.length} سؤال`, `${questions.length} questions`)}
        </span>
      </div>

      <input
        className="w-full rounded-md border px-3 py-2 text-sm"
        value={needle}
        onChange={(e) => setNeedle(e.target.value)}
        placeholder={tr("ابحث في الأسئلة أو المواد…", "Search questions or courses…")}
      />

      {isLoading && !questions.length && (
        <p className="text-sm text-muted-foreground">{tr("جارٍ التحميل…", "Loading…")}</p>
      )}

      {!isLoading && questions.length === 0 && (
        <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
          {tr(
            "لسه مفيش أسئلة محفوظة. اعمل امتحان من صفحة الاختبارات وهيتخزن هنا لوحده.",
            "No saved questions yet. Generate an exam from the Quiz page and it will be kept here.",
          )}
        </div>
      )}

      {groups.map(([subject, items]) => (
        <section key={subject} className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {subject}
            <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
          </h2>
          <div className="space-y-2">
            {items.map((item) => {
              const expanded = open === item.id;
              return (
                <div key={item.id} className="rounded-xl border p-3">
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      className="flex flex-1 items-start gap-2 text-start"
                      onClick={() => setOpen(expanded ? null : item.id)}
                      aria-expanded={expanded}
                    >
                      <ChevronDown
                        className={`mt-0.5 h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
                      />
                      <span className="text-sm font-medium">{item.question}</span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-600"
                      aria-label={tr("حذف", "Delete")}
                      onClick={() => remove(item.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="mt-1 ps-6 text-xs text-muted-foreground">
                    {tr(TYPE_LABEL[item.type][0], TYPE_LABEL[item.type][1])}
                    {item.source ? ` · ${item.source}` : ""}
                  </div>

                  {expanded && (
                    <div className="mt-2 space-y-2 ps-6">
                      {item.type === "mcq" && item.options?.length > 0 && (
                        <ul className="space-y-1 text-sm">
                          {item.options.map((opt, i) => (
                            <li
                              key={i}
                              className={
                                opt.trim().toLowerCase() === item.answer.trim().toLowerCase()
                                  ? "font-medium text-emerald-700 dark:text-emerald-300"
                                  : ""
                              }
                            >
                              {opt}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="rounded-md bg-muted p-2 text-sm">
                        <span className="font-medium">{tr("الإجابة: ", "Answer: ")}</span>
                        {item.answer}
                      </div>
                      {item.explanation && (
                        <div className="rounded-md border bg-card p-2 text-sm">
                          <span className="font-medium">{tr("السبب: ", "Why: ")}</span>
                          {item.explanation}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
