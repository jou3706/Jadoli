"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { QuizQuestion } from "@/lib/ai/schema";

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
  const [selected, setSelected] = useState<number | string | null>(null);
  const [show, setShow] = useState(false);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  const q = questions[i];
  const next = () => {
    if (i < questions.length - 1) {
      setI(i + 1);
      setSelected(null);
      setShow(false);
    } else {
      setDone(true);
    }
  };
  const submit = () => {
    setShow(true);
    if (q.type === "mcq" && typeof selected === "number") {
      if (q.options && q.options[selected] === q.answer) setScore((s) => s + 1);
    } else if (q.type === "truefalse") {
      if (String(selected).toLowerCase() === String(q.answer).toLowerCase()) setScore((s) => s + 1);
    } else if (q.type === "short") {
      setShow(true);
    }
  };
  if (!q) return null;
  if (done) {
    return (
      <div className="space-y-3 rounded-xl border p-6 text-center">
        <div className="text-lg font-semibold">انتهى الاختبار</div>
        <div className="text-sm">نتيجتك: {score} / {questions.length}</div>
        <Button onClick={onDone}>عودة</Button>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border p-4">
      {title && <div className="text-sm text-muted-foreground">{title}</div>}
      <div className="text-base font-medium">{q.question}</div>
      {q.type === "mcq" && q.options && (
        <div className="grid gap-2">
          {q.options.map((opt, idx) => (
            <button key={idx} type="button" onClick={() => setSelected(idx)} className={`rounded-md border px-3 py-2 text-left ${selected === idx ? "border-primary bg-primary/5" : ""}`}>
              {opt}
            </button>
          ))}
        </div>
      )}
      {q.type === "truefalse" && (
        <div className="flex gap-2">
          <Button type="button" variant={selected === "true" ? "default" : "outline"} onClick={() => setSelected("true")}>صح</Button>
          <Button type="button" variant={selected === "false" ? "default" : "outline"} onClick={() => setSelected("false")}>خطأ</Button>
        </div>
      )}
      {q.type === "short" && (
        <input className="w-full rounded-md border px-2 py-1" onChange={(e) => setSelected(e.target.value)} placeholder="اكتب إجابتك" />
      )}
      {show && q.explanation && <div className="rounded-md bg-muted p-3 text-sm">{q.explanation}</div>}
      {show && q.type === "truefalse" && <div className="text-sm">الإجابة الصحيحة: {q.answer}</div>}
      {show && q.type === "mcq" && q.answer && <div className="text-sm">الإجابة الصحيحة: {q.answer}</div>}
      <div className="flex justify-between">
        <div className="text-xs text-muted-foreground">{i + 1} / {questions.length}</div>
        {!show ? (
          <Button onClick={submit} disabled={selected === null || (typeof selected === "string" && selected === "")}>تحقق</Button>
        ) : (
          <Button onClick={next}>التالي</Button>
        )}
      </div>
    </div>
  );
}
