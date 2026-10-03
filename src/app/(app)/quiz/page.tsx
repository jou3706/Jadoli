"use client";
import { useEffect, useState } from "react";
import { useList } from "@/lib/db/store";
import { authHeader } from "@/lib/db/supabase-client";
import { QuizBuilder } from "@/components/ai/quiz-builder";
import { QuizSession } from "@/components/review/quiz-session";
import type { QuizSet, QuizSource } from "@/lib/ai/schema";

export default function QuizPage() {
  const { data: materials = [] } = useList("Material", "-created_date", 200);
  const { data: lectures = [] } = useList("Lecture", "-created_date", 200);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [quiz, setQuiz] = useState<QuizSet | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const s = new Set<string>();
    for (const l of lectures) if (l.subject_name) s.add(l.subject_name.trim());
    for (const m of materials) if (m.subject_key) s.add(m.subject_key.trim());
    setSubjects(Array.from(s).sort());
  }, [lectures, materials]);

  const generate = async (src: QuizSource) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/ai/quiz", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify(src),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.reason || data.error || "generation failed");
      setQuiz(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (quiz) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <QuizSession questions={quiz.questions} title={quiz.title} onDone={() => setQuiz(null)} />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">نظام الاختبارات والأسئلة التفاعلية</h1>
      <QuizBuilder subjects={subjects} materials={materials} onGenerate={generate} busy={busy} />
      {err && <div className="rounded-md border border-red-500/40 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200">{err}</div>}
    </div>
  );
}
