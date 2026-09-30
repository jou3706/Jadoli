"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, CalendarClock, MapPin, User } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList } from "@/lib/db/store";
import { lectureSubtitle, lectureTitle, type NextResult } from "@/lib/schedule";
import { countdown, nowCairo } from "@/lib/utils";
import { colorStyle } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** Live/upcoming lecture with a ticking countdown. */
export function NextCard({ next }: { next: NonNullable<NextResult> }) {
  const { tr, lang } = useI18n();
  const [, tick] = useState(0);
  const live = next.status === "live";

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const c = colorStyle(next.lecture.color);

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-4",
        live && "border-emerald-500/50 ring-1 ring-emerald-500/30",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold text-white",
            live ? "bg-emerald-600" : "bg-amber-500",
          )}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full bg-white",
              live && "animate-pulse",
            )}
          />
          {live ? tr("دلوقتي", "Live now") : tr("الجاية", "Next up")}
        </span>
        <span className="text-xs text-muted-foreground">
          {live ? tr("جارية دلوقتي", "Happening now") : dayLabel(next.lecture.day, lang)}
        </span>
      </div>

      <h3 className="mt-3 font-display text-xl font-bold leading-tight">
        {lectureTitle(next.lecture, lang)}
      </h3>
      {lectureSubtitle(next.lecture, lang) && (
        <p className="truncate text-sm text-muted-foreground">
          {lectureSubtitle(next.lecture, lang)}
        </p>
      )}

      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
        {next.lecture.hall && (
          <p className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> {next.lecture.hall}
          </p>
        )}
        {next.lecture.doctor && (
          <p className="flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" /> {next.lecture.doctor}
          </p>
        )}
      </div>

      <p className="mt-2 text-sm font-semibold tabular-nums text-foreground">
        {next.lecture.start_time} – {next.lecture.end_time}
      </p>

      <div className={cn("mt-3 rounded-xl py-2.5 text-center", c.soft)}>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {live ? tr("باقي على النهاية", "Time left") : tr("يبدأ بعد", "Starts in")}
        </p>
        <p className={cn("font-display text-2xl font-bold tabular-nums", c.text)}>
          {countdown(Math.max(0, next.seconds))}
        </p>
      </div>
    </div>
  );
}

function dayLabel(day: number, lang: "ar" | "en") {
  const names: Record<number, [string, string]> = {
    6: ["السبت", "Sat"],
    0: ["الأحد", "Sun"],
    1: ["الاثنين", "Mon"],
    2: ["الثلاثاء", "Tue"],
    3: ["الأربعاء", "Wed"],
    4: ["الخميس", "Thu"],
    5: ["الجمعة", "Fri"],
  };
  const n = names[day] ?? ["", ""];
  return lang === "en" ? n[1] : n[0];
}

/** Compact "get there on time" prompt for the current or next lecture. */
export function CountdownCard({
  lectureId,
}: {
  lectureId: string;
}) {
  const { tr } = useI18n();
  const { data: lectures = [] } = useList("Lecture", "-created_date", 300);
  const [now, setNow] = useState(() => nowCairo());

  useEffect(() => {
    const id = setInterval(() => setNow(nowCairo()), 30_000);
    return () => clearInterval(id);
  }, []);

  const l = lectures.find((x) => x.id === lectureId);
  if (!l) return null;
  const minutes = Number(l.start_time.slice(0, 2)) * 60 + Number(l.start_time.slice(3));
  const delta = minutes - (now.getHours() * 60 + now.getMinutes());
  if (delta < 0 || delta > 120) return null;

  return (
    <Link
      href="/halls"
      className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3"
    >
      <Bell className="h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{l.subject_name}</p>
        <p className="text-xs text-muted-foreground">
          {delta === 0
            ? tr("دلوقتي!", "Starting now!")
            : tr(`يبدأ بعد ${delta} دقيقة`, `Starts in ${delta} min`)}
        </p>
      </div>
      <CalendarClock className="ms-auto h-4 w-4 shrink-0 text-primary" />
    </Link>
  );
}
