"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useList, useMutate } from "@/lib/db/store";
import { authHeader } from "@/lib/db/supabase-client";
import { QuizBuilder } from "@/components/ai/quiz-builder";
import { QuizSession } from "@/components/review/quiz-session";
import { newQuestions, questionPayload } from "@/lib/quiz-bank";
import type { QuizSet, QuizSource } from "@/lib/ai/schema";
import type { Material } from "@/lib/db/types";

export default function QuizPage() {
  const { data: materials = [] } = useList("Material", "-created_date", 200);
  const { data: lectures = [] } = useList("Lecture", "-created_date", 200);
  const { data: bank = [] } = useList("Question", "-created_date", 1000);
  const { bulkCreate } = useMutate("Question");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [quiz, setQuiz] = useState<(QuizSet & { corrected?: number }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const s = new Set<string>();
    for (const l of lectures) if (l.subject_name) s.add(l.subject_name.trim());
    for (const m of materials) if (m.subject_key) s.add(m.subject_key.trim());
    setSubjects(Array.from(s).sort());
  }, [lectures, materials]);

  const generate = async (src: QuizSource) => {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const res = await fetch("/api/ai/quiz", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify(src),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.reason || data.error || "generation failed");
      const set = data as QuizSet & { corrected?: number };
      setQuiz(set);

      // Save what was not asked before. The bank is the record of the questions
      // already shown, so a repeat exam adds only the new ones.
      const fresh = newQuestions(set.questions, bank, src.subjectKey);
      if (fresh.length) {
        const picked = src.materialIds
          .map((id) => (materials as Material[]).find((m) => m.id === id)?.title ?? "")
          .filter(Boolean);
        const label =
          src.source === "chapter"
            ? `فصل: ${src.chapter ?? ""}`
            : src.source === "topic"
              ? src.topic ?? ""
              : picked.join("، ");
        try {
          await bulkCreate(
            fresh.map((q) => questionPayload(q, { subjectKey: src.subjectKey, source: label })),
          );
        } catch {
          /* already there — the unique index refused a duplicate, which is fine */
        }
      }
      const repeats = set.questions.length - fresh.length;
      setNote(
        `اتحفظ ${fresh.length} سؤال جديد في بنك الأسئلة${repeats > 0 ? ` · ${repeats} مكرر اترفض` : ""}`,
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (quiz) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <QuizSession
          questions={quiz.questions}
          title={quiz.title}
          corrected={quiz.corrected}
          onDone={() => setQuiz(null)}
        />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between" data-tour="quiz-header">
        <h1 className="text-xl font-semibold">نظام الاختبارات والأسئلة التفاعلية</h1>
        <Link href="/questions" className="text-sm text-primary underline" data-tour="quiz-bank">
          بنك الأسئلة
        </Link>
      </div>
      <QuizBuilder subjects={subjects} materials={materials} onGenerate={generate} busy={busy} />
      {err && (
        <div className="rounded-md border border-red-500/40 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200">
          {err}
        </div>
      )}
      {note && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">
          {note}
        </div>
      )}
    </div>
  );
}
