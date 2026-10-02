"use client";

import { useRef, useState } from "react";
import { CalendarPlus, Share2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList } from "@/lib/db/store";
import { useScheduleContext } from "@/lib/schedule-context";
import { searchLectures } from "@/lib/schedule";
import { downloadICS } from "@/lib/export";
import { nowCairo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WeekTable } from "@/components/schedule/week-table";
import { ExportButtons, ShareDialog } from "@/components/schedule/export-buttons";
import type { Lecture } from "@/lib/db/types";

export default function WeekPage() {
  const { tr } = useI18n();
  const { editMode, search, openForm } = useScheduleContext();
  const { data: lectures = [], isLoading } = useList(
    "Lecture",
    "-created_date",
    300,
  );
  const { data: events = [] } = useList("UniversityEvent", "date", 300);
  const { data: sessions = [] } = useList("ReviewSession", "date", 100);
  const tableRef = useRef<HTMLTableElement>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [now] = useState(() => nowCairo());

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[32px] font-bold text-foreground">
            {tr("الأسبوع كله", "Full week")}
          </h1>
          <p className="text-base text-muted-foreground">
            {editMode
              ? tr(
                  "اضغط على أي محاضرة لتعديلها، أو على + لإضافة محاضرة جديدة",
                  "Tap any lecture to edit, or + to add a new one",
                )
              : tr("جدولك من السبت للخميس", "Your schedule, Sat to Thu")}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShareOpen(true)} disabled={isLoading}>
            <Share2 className="h-4 w-4" /> {tr("مشاركة", "Share")}
          </Button>
          {!isLoading && <ExportButtons targetRef={tableRef} />}
          {!isLoading && (
            <Button
              variant="outline"
              onClick={() => downloadICS(lectures, events)}
            >
              <CalendarPlus className="h-4 w-4" />{" "}
              {tr("تقويم", "Calendar")}
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <WeekTable
          ref={tableRef}
          lectures={searchLectures(lectures, search)}
          now={now}
          sessions={sessions.filter((s) => !s.done)}
          editMode={editMode}
          openForm={(arg) =>
            openForm(
              "id" in arg
                ? (arg as Lecture)
                : ({ ...arg, subject_name: "", notes: "" } as unknown as Lecture),
            )
          }
        />
      )}

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">
              {tr("مشاركة الجدول", "Share schedule")}
            </DialogTitle>
          </DialogHeader>
          <ShareDialog lectures={lectures} events={events} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
