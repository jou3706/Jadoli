"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { CalendarPlus, Check, ExternalLink, Pencil, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList, useMutate } from "@/lib/db/store";
import type { Lecture } from "@/lib/db/types";
import { useScheduleContext } from "@/lib/schedule-context";
import { useToast } from "@/components/ui/toast";
import { downloadICS } from "@/lib/export";
import { findNext, dayLabel, searchLectures } from "@/lib/schedule";
import { cn, nowCairo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TodayHero } from "@/components/schedule/today-hero";
import { DayTabs } from "@/components/schedule/day-tabs";
import { LectureList } from "@/components/schedule/lecture-list";
import { CountdownCard, NextCard } from "@/components/schedule/next-card";
import { ExamCard } from "@/components/schedule/exam-card";
import { ImportCard } from "@/components/schedule/import-card";

export function ScheduleScreen() {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const shareToken = params.get("token");
  const { editMode, setEditMode, search, openForm } = useScheduleContext();
  const { data: lectures = [], isLoading } = useList(
    "Lecture",
    "-created_date",
    300,
  );
  const { data: events = [] } = useList("UniversityEvent", "date", 300);
  const { create } = useMutate("Lecture");
  const [now, setNow] = useState(() => nowCairo());
  const [picked, setPicked] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(nowCairo()), 30_000);
    return () => clearInterval(id);
  }, []);

  // `?token=` clones a shared schedule into the signed-in account.
  useEffect(() => {
    if (!shareToken || doneRef.current) return;
    doneRef.current = true;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/share/${shareToken}`);
        if (!res.ok) throw new Error("404");
        const data = (await res.json()) as { lectures: Lecture[] };
        if (!alive || !data.lectures?.length) return;
        setImporting(true);
        await Promise.all(
          data.lectures.map((l) => {
            const { id: _ignored, created_date: _c, ...rest } = l;
            return create(rest);
          }),
        );
        if (!alive) return;
        toast({
          title: tr("تم نسخ الجدول عندك", "Schedule copied to your account"),
          description: tr(
            "تقدر تعدّله زي ما تحب",
            "You can edit it however you like",
          ),
        });
        router.replace("/");
      } catch {
        if (alive) {
          toast({
            title: tr("رابط غير صالح", "That link is not valid"),
            variant: "destructive",
          });
        }
      } finally {
        if (alive) setImporting(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareToken]);

  const today = now.getDay();
  const next = useMemo(() => findNext(lectures, now), [lectures, now]);
  const filtered = useMemo(
    () => searchLectures(lectures, search),
    [lectures, search],
  );

  // Default to today, else the next day that actually has lectures.
  const activeDay = useMemo(() => {
    if (picked !== null) return picked;
    if (filtered.some((l) => Number(l.day) === today)) return today;
    return next?.lecture.day ?? 6;
  }, [picked, filtered, today, next]);

  if (importing) {
    return (
      <div className="grid h-64 place-items-center">
        <div className="space-y-2 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
          <p className="text-sm text-muted-foreground">
            {tr("بننسخ الجدول…", "Copying the schedule…")}
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TodayHero now={now} />

      {lectures.length === 0 && <ImportCard />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="min-w-0 space-y-5 lg:col-span-2">
          <div>
            <h2 className="mb-2 font-heading text-lg font-bold">
              {dayLabel(activeDay, lang, true)}
              {activeDay === today && (
                <span className="ms-2 text-sm font-normal text-primary">
                  {tr("— النهاردة", "— today")}
                </span>
              )}
            </h2>
            <DayTabs
              value={activeDay}
              onChange={setPicked}
              lectures={filtered}
              today={today}
            />
          </div>

          <LectureList lectures={filtered} day={activeDay} now={now} />

          {editMode && (
            <Button
              variant="outline"
              className="h-12 w-full gap-2 text-base"
              onClick={() => openForm(null)}
            >
              <Plus className="h-4 w-4" /> {tr("محاضرة جديدة", "New lecture")}
            </Button>
          )}
        </section>

        <aside className="space-y-5">
          {next && <NextCard next={next} />}

          <ExamCard events={events} now={now} />

          {next && <CountdownCard lectureId={next.lecture.id} />}

          <Button asChild variant="outline" className="h-12 w-full gap-2 text-base">
            <Link href="/week">
              <CalendarPlus className="h-4 w-4" /> {tr("عرض الأسبوع", "Week view")}
            </Link>
          </Button>

          <Button
            onClick={() => downloadICS(lectures, events)}
            variant="outline"
            className={cn("h-12 w-full gap-2 text-base")}
          >
            <ExternalLink className="h-4 w-4" />{" "}
            {tr("تصدير التقويم", "Export calendar")}
          </Button>

          <Button
            onClick={() => setEditMode((p) => !p)}
            variant={editMode ? "default" : "outline"}
            className="hidden h-12 w-full gap-2 text-base lg:flex"
          >
            {editMode ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            {editMode
              ? tr("خلصت التعديل", "Done editing")
              : tr("تعديل الجدول", "Edit schedule")}
          </Button>
        </aside>
      </div>
    </div>
  );
}
