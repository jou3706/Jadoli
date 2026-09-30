"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { dayLabel, sortByWeek } from "@/lib/schedule";
import { colorStyle, TABLE_DAYS } from "@/lib/constants";
import { downloadICS } from "@/lib/export";
import { formatTime, nowCairo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { SharePayload } from "@/lib/share-types";

/** Read-only view of somebody else's schedule. */
export function SharedSchedule({ payload }: { payload: SharePayload }) {
  const { tr, lang } = useI18n();
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const now = nowCairo();

  const sorted = useMemo(() => sortByWeek(payload.lectures), [payload.lectures]);
  const byDay = useMemo(() => {
    const map = new Map<number, typeof sorted>();
    for (const l of sorted) {
      const list = map.get(Number(l.day)) ?? [];
      list.push(l);
      map.set(Number(l.day), list);
    }
    return map;
  }, [sorted]);

  const shown =
    activeDay === null
      ? sorted
      : (byDay.get(activeDay) ?? []);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4">
      <header className="space-y-1 text-center">
        <p className="text-sm text-muted-foreground">
          {tr("جدول دراسي مشاركة", "A shared study schedule")}
        </p>
        <h1 className="font-display text-3xl font-bold">
          {payload.owner_name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {payload.lectures.length} {tr("محاضرة", "lectures")}
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          onClick={() => downloadICS(payload.lectures, payload.events, "shared-schedule.ics")}
        >
          <CalendarPlus className="h-4 w-4" /> {tr("ضيفه لتقويمك", "Add to calendar")}
        </Button>
        <Button asChild variant="outline">
          <Link href="/">
            <Sparkles className="h-4 w-4" /> {tr("اعملك جدول", "Build your own")}
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap justify-center gap-1.5">
        <button
          onClick={() => setActiveDay(null)}
          className={`rounded-full px-3 py-1.5 text-sm font-bold ${
            activeDay === null ? "bg-primary text-primary-foreground" : "bg-muted"
          }`}
        >
          {tr("الكل", "All")}
        </button>
        {TABLE_DAYS.filter((d) => byDay.has(d)).map((d) => (
          <button
            key={d}
            onClick={() => setActiveDay(d)}
            className={`rounded-full px-3 py-1.5 text-sm font-bold ${
              activeDay === d ? "bg-primary text-primary-foreground" : "bg-muted"
            }`}
          >
            {dayLabel(d, lang)}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-card p-10 text-center text-muted-foreground">
          {tr("مفيش محاضرات", "No lectures")}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((l) => {
            const c = colorStyle(l.color);
            return (
              <li
                key={l.id}
                className={`flex items-center gap-3 rounded-2xl border bg-card p-3 ${c.bar} border-s-4`}
              >
                <span className="shrink-0 text-center">
                  <span className="block text-xs text-muted-foreground">
                    {dayLabel(Number(l.day), lang)}
                  </span>
                  <span className="block text-sm font-bold tabular-nums">
                    {formatTime(l.start_time)}
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold" dir="auto">
                    {lang === "en" && l.subject_en ? l.subject_en : l.subject_name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatTime(l.start_time)} – {formatTime(l.end_time)}
                    {l.hall && ` · ${l.hall}`}
                    {l.doctor && ` · ${l.doctor}`}
                  </p>
                </div>
                {l.kind === "section" && (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold">
                    {tr("تمارين", "Section")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {payload.events.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold">
            {tr("مناسبات", "Events")}
          </h2>
          <ul className="space-y-1.5">
            {payload.events.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm"
              >
                <span className="shrink-0 font-bold tabular-nums" dir="ltr">
                  {e.date}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {lang === "en" ? e.title_en || e.title : e.title}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="pb-6 text-center text-xs text-muted-foreground">
        {now.getFullYear()} · Jadoli
      </p>
    </div>
  );
}
