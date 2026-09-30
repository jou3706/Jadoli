"use client";

import { useI18n } from "@/lib/i18n";
import { EVENT_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { UniversityEvent } from "@/lib/db/types";

/** Next upcoming exam, with a day countdown. */
export function ExamCard({
  events,
  now,
}: {
  events: UniversityEvent[];
  now: Date;
}) {
  const { tr, lang } = useI18n();
  const locale = lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB";

  const exam = events
    .filter((e) => e.type === "exam" && e.date)
    .map((e) => ({ ...e, d: new Date(`${e.date}T00:00:00`) }))
    .filter((e) => e.d >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
    .sort((a, b) => a.d.getTime() - b.d.getTime())[0];

  if (!exam) return null;

  const days = Math.round(
    (exam.d.getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000,
  );
  const title = lang === "en" ? exam.title_en || exam.title : exam.title;
  const tone = EVENT_TYPES.find((t) => t.k === "exam")!;

  return (
    <div className="rounded-2xl border border-rose-500/20 bg-gradient-to-br from-rose-500/10 to-transparent p-4">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold",
            tone.cls,
          )}
        >
          {tr("امتحان", "Exam")}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-display text-4xl font-bold tabular-nums text-rose-600">
          {days}
        </span>
        <span className="text-sm font-bold text-rose-600/70">
          {days === 0 ? tr("النهارده!", "Today!") : tr("يوم", "days")}
        </span>
      </div>
      <p className="mt-1 font-bold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground">
        {exam.d.toLocaleDateString(locale, {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
      </p>
      {exam.note && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {exam.note}
        </p>
      )}
    </div>
  );
}
