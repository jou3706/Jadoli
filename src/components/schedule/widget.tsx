"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarX2, CheckCircle2, Clock, MapPin } from "lucide-react";
import { useList } from "@/lib/db/store";
import { useAttendance } from "@/hooks/use-attendance";
import { useToast } from "@/components/ui/toast";
import { findNext, lectureTitle, searchLectures } from "@/lib/schedule";
import { colorStyle, TABLE_DAYS, dayShort } from "@/lib/constants";
import { cn, formatTime, nowCairo } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { DownloadICS } from "@/components/schedule/widget-download";

/**
 * Embeddable mini timetable: `/widget?token=…` for a shared link, or
 * `/widget` for the visitor's own local schedule. No chrome, no sidebar.
 */
export function Widget() {
  const params = useSearchParams();
  const token = params.get("token");
  const { tr, lang } = useI18n();
  const toast = useToast();
  const [shared, setShared] = useState<
    | { owner_name: string; lectures: import("@/lib/db/types").Lecture[] }
    | null
  >(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [day, setDay] = useState<number | null>(null);
  const [q, setQ] = useState("");

  const { data: local = [] } = useList("Lecture", "-created_date", 300);
  const [now, setNow] = useState(() => nowCairo());

  useEffect(() => {
    const id = setInterval(() => setNow(nowCairo()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    fetch(`/api/share/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("404"))))
      .then((d) => alive && setShared(d))
      .catch(() =>
        alive
          ? toast({
              title: tr("رابط غير صالح", "That link is not valid"),
              variant: "destructive",
            })
          : undefined,
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const lectures = shared?.lectures ?? local;
  const filtered = useMemo(() => searchLectures(lectures, q), [lectures, q]);
  const byDay = useMemo(() => {
    const map = new Map<number, typeof filtered>();
    for (const l of filtered) {
      const list = map.get(Number(l.day)) ?? [];
      list.push(l);
      map.set(Number(l.day), list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    }
    return map;
  }, [filtered]);

  const shown = day === null ? filtered : (byDay.get(day) ?? []);
  const next = useMemo(() => findNext(lectures, now), [lectures, now]);
  const { isAttended, toggle } = useAttendance(now);

  if (loading) {
    return (
      <div className="grid min-h-40 place-items-center p-4">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  if (!lectures.length) {
    return (
      <div className="grid min-h-40 place-items-center p-6 text-center">
        <div>
          <CalendarX2 className="mx-auto h-7 w-7 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            {tr("مفيش محاضرات", "No lectures yet")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-heading text-sm font-bold">
          {shared ? shared.owner_name : tr("جدولي", "My schedule")}
        </span>
        {next && (
          <span
            className={cn(
              "ms-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
              next.status === "live"
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-700",
            )}
          >
            {next.status === "live" ? tr("دلوقتي", "Live") : tr("الجاية", "Next")} ·{" "}
            {lectureTitle(next.lecture, lang)}
          </span>
        )}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={tr("دوّر…", "Search…")}
        className="h-8 w-full rounded-md border bg-background px-2 text-xs"
      />

      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setDay(null)}
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-bold",
            day === null ? "bg-primary text-primary-foreground" : "bg-muted",
          )}
        >
          {tr("الكل", "All")}
        </button>
        {TABLE_DAYS.filter((d) => byDay.has(d)).map((d) => (
          <button
            key={d}
            onClick={() => setDay(d)}
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-bold",
              day === d ? "bg-primary text-primary-foreground" : "bg-muted",
            )}
          >
            {dayShort(d, lang)}
          </button>
        ))}
      </div>

      <ul className="space-y-1.5">
        {shown.map((l) => {
          const c = colorStyle(l.color);
          const live = next?.lecture.id === l.id && next.status === "live";
          return (
            <li
              key={l.id}
              className={cn("flex items-center gap-2 rounded-lg border p-2", c.soft)}
            >
              <span className="w-14 shrink-0 text-center text-[10px] font-bold">
                {dayShort(Number(l.day), lang)}
                <span className="block tabular-nums">
                  {formatTime(l.start_time)}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold" dir="auto">
                  {lectureTitle(l, lang)}
                </span>
                <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  {l.hall && (
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin className="h-2.5 w-2.5" />
                      {l.hall}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-0.5">
                    <Clock className="h-2.5 w-2.5" />
                    {formatTime(l.start_time)}–{formatTime(l.end_time)}
                  </span>
                </span>
              </span>
              {!shared && (
                <button
                  onClick={() => toggle(l)}
                  aria-label={tr("حضور", "Attendance")}
                  className={cn(
                    "shrink-0 rounded-full p-1",
                    isAttended(l) ? "bg-emerald-500 text-white" : "bg-background/70",
                  )}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </button>
              )}
              {live && !shared && (
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
              )}
            </li>
          );
        })}
      </ul>

      <DownloadICS lectures={lectures} />
    </div>
  );
}
