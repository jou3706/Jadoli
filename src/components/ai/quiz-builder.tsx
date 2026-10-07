"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Material } from "@/lib/db/types";
import { MAX_QUIZ_QUESTIONS, MIN_QUIZ_QUESTIONS, type QuizSource } from "@/lib/ai/schema";

/**
 * Choosing what an exam is made from.
 *
 * Every material on the chosen course is listed, and the student ticks the ones
 * they want the questions drawn from — one file or all of them. The count and the
 * language are chosen here too, so the exam is sized before it is generated rather
 * than trimmed afterwards.
 */
export function QuizBuilder({
  subjects,
  materials,
  onGenerate,
  busy,
  defaultSubject,
  defaultTopic,
}: {
  subjects: string[];
  materials: Material[];
  onGenerate: (src: QuizSource) => void;
  busy: boolean;
  /** Prefilled when the assistant already worked out the course. */
  defaultSubject?: string;
  defaultTopic?: string;
}) {
  const [subjectKey, setSubjectKey] = useState(defaultSubject || subjects[0] || "");
  const [source, setSource] = useState<QuizSource["source"]>("material");
  const [picked, setPicked] = useState<string[]>([]);
  const [chapter, setChapter] = useState("");
  const [topic, setTopic] = useState(defaultTopic ?? "");
  const [count, setCount] = useState(10);
  const [language, setLanguage] = useState<QuizSource["language"]>("auto");

  useEffect(() => {
    if (defaultSubject) setSubjectKey(defaultSubject);
  }, [defaultSubject]);

  const matsForSubj = useMemo(
    () => materials.filter((m) => (m.subject_key || "").trim() === subjectKey.trim()),
    [materials, subjectKey],
  );

  // Every file is ticked when the course changes: the student asked for an exam
  // on the course, and unticking the ones they do not want is less work than
  // ticking every one they do.
  useEffect(() => {
    setPicked(matsForSubj.map((m) => m.id));
    setSource(matsForSubj.length === 0 ? "topic" : "material");
  }, [matsForSubj]);

  // Keep the subject the assistant worked out visible even if its spelling does
  // not exactly match a saved course, so the student can see and correct it.
  const subjectOptions =
    subjectKey && !subjects.includes(subjectKey) ? [subjectKey, ...subjects] : subjects;

  const allTicked = picked.length === matsForSubj.length && matsForSubj.length > 0;
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const canGenerate =
    !!subjectKey &&
    ((source === "material" && picked.length > 0) ||
      (source === "chapter" && !!chapter.trim()) ||
      (source === "topic" && !!topic.trim()));

  return (
    <div className="space-y-3 rounded-xl border p-4" data-tour="quiz-builder">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="text-xs">المادة / Subject</label>
          <select
            className="w-full rounded-md border px-2 py-1"
            value={subjectKey}
            onChange={(e) => setSubjectKey(e.target.value)}
          >
            {subjectOptions.length === 0 ? (
              <option value="">--</option>
            ) : (
              subjectOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))
            )}
          </select>
        </div>
        <div>
          <label className="text-xs">عدد الأسئلة / Count</label>
          <input
            type="number"
            min={MIN_QUIZ_QUESTIONS}
            max={MAX_QUIZ_QUESTIONS}
            step={1}
            inputMode="numeric"
            className="w-full rounded-md border px-2 py-1"
            value={count}
            onChange={(e) =>
              setCount(
                Math.min(
                  MAX_QUIZ_QUESTIONS,
                  Math.max(MIN_QUIZ_QUESTIONS, Number(e.target.value) || MIN_QUIZ_QUESTIONS),
                ),
              )
            }
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            من {MIN_QUIZ_QUESTIONS} لـ {MAX_QUIZ_QUESTIONS} / {MIN_QUIZ_QUESTIONS} to{" "}
            {MAX_QUIZ_QUESTIONS}
          </p>
        </div>
        <div>
          <label className="text-xs">اللغة / Language</label>
          <select
            className="w-full rounded-md border px-2 py-1"
            value={language}
            onChange={(e) => setLanguage(e.target.value as QuizSource["language"])}
          >
            <option value="auto">تلقائي (حسب الملف أو العنوان)</option>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={source === "material" ? "default" : "outline"}
          size="sm"
          onClick={() => setSource("material")}
          disabled={matsForSubj.length === 0}
        >
          من ملفات المادة / From materials
        </Button>
        <Button
          type="button"
          variant={source === "chapter" ? "default" : "outline"}
          size="sm"
          onClick={() => setSource("chapter")}
        >
          من فصل/باب / From chapter
        </Button>
        <Button
          type="button"
          variant={source === "topic" ? "default" : "outline"}
          size="sm"
          onClick={() => setSource("topic")}
        >
          عنوان موضوع يدوي / Custom topic
        </Button>
      </div>

      {matsForSubj.length === 0 && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-50 p-2 text-xs text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
          هذه المادة لا تحتوي على أي مواد مرفقة بعد. أدخل عنوان درس/موضوع لإنشاء أسئلة بناء عليه.
        </div>
      )}

      {source === "material" && matsForSubj.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs">
              اختر الملفات / Choose materials ({picked.length} / {matsForSubj.length})
            </label>
            <button
              type="button"
              className="text-xs text-primary underline"
              onClick={() => setPicked(allTicked ? [] : matsForSubj.map((m) => m.id))}
            >
              {allTicked ? "إلغاء الكل" : "تحديد الكل"}
            </button>
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
            {matsForSubj.map((m) => {
              const on = picked.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm",
                    on ? "bg-primary/10 text-foreground" : "hover:bg-muted",
                  )}
                  aria-pressed={on}
                >
                  <span
                    className={cn(
                      "grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px]",
                      on ? "border-primary bg-primary text-primary-foreground" : "",
                    )}
                  >
                    {on ? "✓" : ""}
                  </span>
                  <span className="truncate">
                    {m.title || "بدون عنوان"} {m.type ? `(${m.type})` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {source === "chapter" && (
        <div>
          <label className="text-xs">اسم الفصل/الجزء / Chapter</label>
          <input
            className="w-full rounded-md border px-2 py-1"
            value={chapter}
            onChange={(e) => setChapter(e.target.value)}
            placeholder="مثال: Chapter 1"
          />
        </div>
      )}
      {source === "topic" && (
        <div>
          <label className="text-xs">عنوان الدرس أو الموضوع / Lesson/topic</label>
          <input
            className="w-full rounded-md border px-2 py-1"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="مثال: أنواع قواعد البيانات"
          />
        </div>
      )}

      <div className="flex justify-end">
        <Button
          disabled={busy || !canGenerate}
          onClick={() =>
            onGenerate({
              subjectKey,
              source,
              materialIds: source === "material" ? picked : [],
              chapter: source === "chapter" ? chapter : undefined,
              topic: source === "topic" ? topic : undefined,
              count,
              language,
            })
          }
        >
          {busy ? "جارٍ التوليد..." : "إنشاء أسئلة"}
        </Button>
      </div>
    </div>
  );
}
