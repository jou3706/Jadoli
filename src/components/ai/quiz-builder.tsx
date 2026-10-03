"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Material } from "@/lib/db/types";

export type QuizSource = {
  subjectKey: string;
  source: "material" | "chapter" | "topic";
  materialId?: string;
  materialTitle?: string;
  materialFilePath?: string;
  chapter?: string;
  topic?: string;
  count: number;
  language: "ar" | "en";
};

export function QuizBuilder({
  subjects,
  materials,
  onGenerate,
  busy,
}: {
  subjects: string[];
  materials: Material[];
  onGenerate: (src: QuizSource) => void;
  busy: boolean;
}) {
  const [subjectKey, setSubjectKey] = useState(subjects[0] ?? "");
  const [source, setSource] = useState<QuizSource["source"]>("material");
  const [materialId, setMaterialId] = useState("");
  const [chapter, setChapter] = useState("");
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(10);
  const [language, setLanguage] = useState<"ar" | "en">("ar");
  const [needsTopic, setNeedsTopic] = useState(false);

  const matsForSubj = materials.filter((m) => (m.subject_key || "").trim() === subjectKey);
  useEffect(() => {
    setNeedsTopic(matsForSubj.length === 0);
    if (source === "material" && matsForSubj.length > 0 && !matsForSubj.find((m) => m.id === materialId)) {
      setMaterialId(matsForSubj[0].id);
    }
    if (matsForSubj.length === 0) {
      setSource("topic");
    } else if (source === "topic") {
      setSource("material");
    }
  }, [subjectKey, matsForSubj, materialId, source]);

  const mat = matsForSubj.find((m) => m.id === materialId);
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="text-xs">المادة / Subject</label>
          <select className="w-full rounded-md border px-2 py-1" value={subjectKey} onChange={(e) => setSubjectKey(e.target.value)}>
            {subjects.length === 0 ? <option value="">--</option> : subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs">عدد الأسئلة / Count</label>
          <input type="number" min={3} max={20} className="w-full rounded-md border px-2 py-1" value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </div>
        <div>
          <label className="text-xs">اللغة / Language</label>
          <select className="w-full rounded-md border px-2 py-1" value={language} onChange={(e) => setLanguage(e.target.value as "ar" | "en")}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={source === "material" ? "default" : "outline"} size="sm" onClick={() => setSource("material")} disabled={matsForSubj.length === 0}>
          من ملف محدد / From material
        </Button>
        <Button type="button" variant={source === "chapter" ? "default" : "outline"} size="sm" onClick={() => setSource("chapter")}>
          من فصل/باب / From chapter
        </Button>
        <Button type="button" variant={source === "topic" ? "default" : "outline"} size="sm" onClick={() => setSource("topic")}>
          عنوان موضوع يدوي / Custom topic
        </Button>
      </div>

      {needsTopic && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-50 p-2 text-xs text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
          هذه المادة لا تحتوي على أي مواد مرفقة بعد. أدخل عنوان درس/موضوع لإنشاء أسئلة بناء عليه.
        </div>
      )}

      {source === "material" && matsForSubj.length > 0 && (
        <div>
          <label className="text-xs">اختر ملف / Choose material</label>
          <select className="w-full rounded-md border px-2 py-1" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
            {matsForSubj.map((m) => <option key={m.id} value={m.id}>{m.title} ({m.type})</option>)}
          </select>
        </div>
      )}
      {source === "chapter" && (
        <div>
          <label className="text-xs">اسم الفصل/الجزء / Chapter</label>
          <input className="w-full rounded-md border px-2 py-1" value={chapter} onChange={(e) => setChapter(e.target.value)} placeholder="مثال: Chapter 1" />
        </div>
      )}
      {source === "topic" && (
        <div>
          <label className="text-xs">عنوان الدرس أو الموضوع / Lesson/topic</label>
          <input className="w-full rounded-md border px-2 py-1" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="مثال: أنواع قواعد البيانات" />
        </div>
      )}

      <div className="flex justify-end">
        <Button
          disabled={busy || (source === "material" && !mat) || (source === "chapter" && !chapter.trim()) || (source === "topic" && !topic.trim()) || !subjectKey}
          onClick={() =>
            onGenerate({
              subjectKey,
              source,
              materialId: mat?.id,
              materialTitle: mat?.title,
              materialFilePath: mat?.file_path,
              chapter: chapter || undefined,
              topic: topic || undefined,
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
