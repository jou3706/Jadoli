"use client";

import {
  BookOpen,
  CalendarClock,
  CheckCheck,
  Clock,
  FileText,
  GraduationCap,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { dayName } from "@/lib/constants";
import { findNext, lectureTitle } from "@/lib/schedule";
import { useFilter, useList } from "@/lib/db/store";
import { weekStartKey } from "@/lib/utils";
import type { Attendance, Grade, UniversityEvent } from "@/lib/db/types";
import { cn } from "@/lib/utils";

const TONES = {
  blue: "text-sky-600 dark:text-sky-400",
  violet: "text-violet-600 dark:text-violet-400",
  amber: "text-amber-600 dark:text-amber-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
} as const;

function Stat({
  icon: Icon,
  tone,
  children,
}: {
  icon: typeof Clock;
  tone: keyof typeof TONES;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border bg-background/60 px-3 py-2 text-sm",
        TONES[tone],
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 text-foreground">{children}</span>
    </div>
  );
}

export function TodayHero({ now }: { now: Date }) {
  const { tr, lang } = useI18n();
  const { data: lectures = [] } = useList("Lecture", "-created_date", 300);
  const { data: events = [] } = useList("UniversityEvent", "date", 300);
  const { data: grades = [] } = useList("Grade");
  const week = weekStartKey(now);
  const { data: attendance = [] } = useFilter(
    "Attendance",
    { week_start: week },
    undefined,
    500,
    [week],
  );

  const today = lectures.filter((l) => Number(l.day) === now.getDay());
  const next = findNext(lectures, now);

  const exam = (events as UniversityEvent[])
    .filter((e) => e.type === "exam" && e.date && e.date >= week)
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  let examDays: number | null = null;
  if (exam) {
    const target = new Date(`${exam.date}T00:00:00`);
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    examDays = Math.round((target.getTime() - base.getTime()) / 86_400_000);
  }

  const hours = (grades as Grade[]).reduce(
    (n, g) => n + (Number(g.credit_hours) || 0),
    0,
  );
  const points = (grades as Grade[]).reduce(
    (n, g) => n + (Number(g.credit_hours) || 0) * (Number(g.grade_point) || 0),
    0,
  );
  const gpa = hours ? points / hours : 0;

  const attended = (attendance as Attendance[]).length;
  // Every lecture is a weekly meeting, so the week's chances are the lectures on
  // the schedule (the same denominator the attendance page uses). Clamped: an
  // attendance for a lecture no longer on the list must not read above 100%.
  const pct = lectures.length
    ? Math.min(100, Math.round((attended / lectures.length) * 100))
    : 0;

  const greeting =
    now.getHours() < 12
      ? tr("صباح الخير 👋", "Good morning 👋")
      : now.getHours() < 18
        ? tr("نهارك سعيد 👋", "Good afternoon 👋")
        : tr("مساء الخير 👋", "Good evening 👋");

  return (
    <div className="rounded-2xl border bg-gradient-to-l from-primary/5 to-card p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <BookOpen className="h-5 w-5 text-primary" />
        <h2 className="font-display text-lg font-bold">{greeting}</h2>
        <span className="text-sm text-muted-foreground">
          — {dayName(now.getDay(), lang)} {now.getDate()}/{now.getMonth() + 1}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <Stat icon={Clock} tone="blue">
          {today.length > 0 ? (
            <>
              <span className="font-semibold">{today.length}</span>{" "}
              {tr("محاضرات النهاردة", "lectures today")}
            </>
          ) : (
            tr("مفيش محاضرات النهاردة — يوم رايق", "No lectures today — chill day")
          )}
        </Stat>

        {next && (
          <Stat icon={CalendarClock} tone="violet">
            {tr("الجاية: ", "Next: ")}
            <span className="truncate font-medium">
              {lectureTitle(next.lecture, lang)}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              — {next.lecture.start_time}
            </span>
          </Stat>
        )}

        {exam && (
          <Stat icon={FileText} tone="amber">
            {tr("امتحان ", "Exam ")}
            <span className="truncate font-medium">
              {lang === "en" ? exam.title_en || exam.title : exam.title}
            </span>
            {examDays !== null && (
              <span className="shrink-0 font-semibold text-amber-600 dark:text-amber-400">
                {examDays === 0
                  ? tr("النهاردة!", "today!")
                  : tr(`بعد ${examDays} يوم`, `in ${examDays} days`)}
              </span>
            )}
          </Stat>
        )}

        {hours > 0 && (
          <Stat icon={GraduationCap} tone="emerald">
            {tr("معدلك الحالي: ", "Current GPA: ")}
            <span className="font-display text-base font-bold tabular-nums text-primary">
              {gpa.toFixed(2)}
            </span>
          </Stat>
        )}

        {today.length > 0 && (
          <Stat icon={CheckCheck} tone={pct >= 75 ? "emerald" : "amber"}>
            {tr("حضور الأسبوع: ", "This week: ")}
            <span className="font-semibold tabular-nums">
              {attended}/{lectures.length}
            </span>
            <span className="text-muted-foreground">({pct}%)</span>
          </Stat>
        )}
      </div>
    </div>
  );
}
