"use client";

import { useMemo } from "react";
import { CheckCircle2, ClipboardCheck, Flame, TrendingUp } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList } from "@/lib/db/store";
import { cn, nowCairo, weekStartKey, type Lang } from "@/lib/utils";
import { lectureTitle } from "@/lib/schedule";

/** The 8 most recent weeks, including empty ones, so gaps stay visible. */
const WEEKS_SHOWN = 8;

export default function AttendancePage() {
  const { tr, lang } = useI18n();
  const l: Lang = lang;
  const now = nowCairo();
  const thisWeek = weekStartKey(now);

  const { data: lectures = [] } = useList("Lecture", "-created_date", 300);
  const { data: records = [] } = useList("Attendance", "-date", 2000);

  /** Unique attended lectures per week — a week can hold repeats. */
  const perWeek = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const r of records) {
      if (!r.week_start) continue;
      let set = map.get(r.week_start);
      if (!set) map.set(r.week_start, (set = new Set()));
      set.add(r.lecture_id);
    }
    return map;
  }, [records]);

  const series = useMemo(() => {
    const out: { key: string; count: number }[] = [];
    const base = new Date(`${thisWeek}T00:00:00Z`);
    for (let i = WEEKS_SHOWN - 1; i >= 0; i--) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() - i * 7);
      const key = d.toISOString().slice(0, 10);
      out.push({ key, count: perWeek.get(key)?.size ?? 0 });
    }
    return out;
  }, [perWeek, thisWeek]);

  const byLecture = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records) map.set(r.lecture_id, (map.get(r.lecture_id) ?? 0) + 1);
    return map;
  }, [records]);

  const rows = useMemo(() => {
    // Every lecture is a weekly meeting, so the number of weeks on record is
    // the number of chances to attend it.
    const tracked = new Set<string>([...perWeek.keys(), thisWeek]);
    const chances = [...tracked].filter((w) => w <= thisWeek).sort();
    return lectures
      .map((lecture) => {
        const attended = byLecture.get(lecture.id) ?? 0;
        const since = lecture.created_date
          ? weekStartKey(new Date(lecture.created_date))
          : chances[0];
        const opportunities = Math.max(attended, chances.filter((w) => w >= since).length);
        return {
          lecture,
          attended,
          opportunities,
          pct: opportunities ? attended / opportunities : 0,
        };
      })
      .filter((r) => r.attended > 0 || r.opportunities > 0)
      .sort((a, b) => a.pct - b.pct || b.attended - a.attended);
  }, [lectures, byLecture, perWeek, thisWeek]);

  const thisWeekCount = perWeek.get(thisWeek)?.size ?? 0;
  const thisWeekPct = lectures.length ? thisWeekCount / lectures.length : 0;
  const totalAttended = useMemo(() => {
    const seen = new Set<string>();
    for (const r of records) seen.add(`${r.lecture_id}|${r.week_start ?? r.date}`);
    return seen.size;
  }, [records]);
  const weeksTracked = perWeek.size;
  const peak = Math.max(1, ...series.map((s) => s.count));
  const best = rows.find((r) => r.attended > 0);

  const pctTone = (p: number) =>
    p >= 0.9
      ? "text-emerald-600"
      : p >= 0.7
        ? "text-sky-600"
        : p >= 0.5
          ? "text-amber-600"
          : "text-rose-600";

  const day = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground sm:text-[32px]">
          {tr("تتبع الحضور", "Attendance")}
        </h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          {tr(
            "سجّل محاضراتك اللي حضرتها وشوف نسبتك أسبوع بأسبوع.",
            "Log the lectures you attended and watch your rate week by week.",
          )}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="rounded-xl border bg-primary/5 p-3 text-center sm:rounded-2xl sm:p-5">
          <ClipboardCheck className="mx-auto h-6 w-6 text-primary sm:h-7 sm:w-7" />
          <p className="mt-1 text-[10px] text-muted-foreground sm:mt-2 sm:text-sm">
            {tr("حضور الأسبوع", "This week")}
          </p>
          <p className={cn("font-display text-2xl font-bold tabular-nums sm:text-4xl", pctTone(thisWeekPct))}>
            {lectures.length ? `${Math.round(thisWeekPct * 100)}%` : "—"}
          </p>
          <p className="text-[10px] text-muted-foreground sm:text-xs">
            {thisWeekCount}/{lectures.length}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-3 text-center sm:rounded-2xl sm:p-5">
          <CheckCircle2 className="mx-auto h-6 w-6 text-primary sm:h-7 sm:w-7" />
          <p className="mt-1 text-[10px] text-muted-foreground sm:mt-2 sm:text-sm">
            {tr("محاضرات حضرتها", "Sessions attended")}
          </p>
          <p className="font-display text-2xl font-bold tabular-nums sm:text-4xl">
            {totalAttended}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-3 text-center sm:rounded-2xl sm:p-5">
          <Flame className="mx-auto h-6 w-6 text-primary sm:h-7 sm:w-7" />
          <p className="mt-1 text-[10px] text-muted-foreground sm:mt-2 sm:text-sm">
            {tr("أسابيع متتبَّعة", "Weeks tracked")}
          </p>
          <p className="font-display text-2xl font-bold tabular-nums sm:text-4xl">
            {weeksTracked}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <TrendingUp className="h-4 w-4 text-primary" />
          {tr("آخر 8 أسابيع", "Last 8 weeks")}
        </p>
        <div className="mt-3 flex h-32 items-end gap-1.5">
          {series.map((s) => (
            <div key={s.key} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                {s.count || ""}
              </span>
              <div
                className={cn(
                  "w-full rounded-t-md transition-all",
                  s.key === thisWeek ? "bg-primary" : "bg-primary/40",
                )}
                style={{ height: `${Math.max(4, (s.count / peak) * 88)}%` }}
                title={`${day(s.key)} — ${s.count}`}
              />
              <span className="text-[9px] text-muted-foreground">{day(s.key)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">
          {tr("نسبتك حسب المادة", "Rate by course")}
        </h2>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            {tr(
              "لسه مفيش تسجيلات — افتح صفحة الأسبوع وسجّل حضورك.",
              "Nothing recorded yet — open the Week page and mark your attendance.",
            )}
          </p>
        ) : (
          rows.map(({ lecture, attended, opportunities, pct }) => (
            <div key={lecture.id} className="rounded-xl border bg-card p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate font-semibold">
                  {lectureTitle(lecture, l)}
                </p>
                <p className={cn("shrink-0 text-sm font-bold tabular-nums", pctTone(pct))}>
                  {Math.round(pct * 100)}%
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {tr("حضرت", "Attended")} {attended} / {opportunities}{" "}
                {tr("فرصة", "chances")}
              </p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, pct * 100)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>

      {best && best.attended > 0 && (
        <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">
          {tr("أحسن حضور ليك في", "Your best attendance is in")}{" "}
          <span className="font-semibold text-foreground">
            {lectureTitle(best.lecture, l)}
          </span>
          .
        </p>
      )}
    </div>
  );
}
