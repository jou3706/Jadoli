"use client";

import { Check, MapPin, Pencil, Trash2, User, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { colorStyle } from "@/lib/constants";
import {
  lectureKindLabel,
  lectureStatus,
  lectureSubtitle,
  lectureTitle,
} from "@/lib/schedule";
import { cn, formatTime, toMinutes } from "@/lib/utils";
import type { Lecture } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { SubjectEventsFor } from "@/components/subjects/subject-events-popover";

export function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-bold tracking-wide text-white">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
      </span>
      LIVE NOW
    </span>
  );
}

export function LectureCard({
  lecture,
  now,
  editMode,
  onEdit,
  onDelete,
  attended,
  onToggleAttendance,
}: {
  lecture: Lecture;
  now: Date;
  editMode: boolean;
  onEdit: () => void;
  onDelete: () => void;
  attended?: boolean;
  onToggleAttendance?: () => void;
}) {
  const { tr, lang } = useI18n();
  const c = colorStyle(lecture.color);
  const status = lectureStatus(lecture, now);
  const live = status === "live";
  const past = status === "past";
  const subtitle = lectureSubtitle(lecture, lang);

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-2xl border border-s-4 bg-card p-3 transition-shadow sm:p-4",
        c.bar,
        live && "ring-2 ring-emerald-600",
        past && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg font-bold leading-tight">
              {lectureTitle(lecture, lang)}
            </h3>
            {live && <LiveBadge />}
            {lecture.kind === "section" && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold",
                  c.soft,
                  c.text,
                )}
              >
                {lectureKindLabel(lecture.kind, lang)}
              </span>
            )}
            <SubjectEventsFor subject={lecture.subject_name} />
          </div>

          {subtitle && (
            <p className="truncate text-xs text-muted-foreground" dir="auto">
              {subtitle}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="tabular-nums font-medium text-foreground">
              {formatTime(lecture.start_time)} — {formatTime(lecture.end_time)}
            </span>
            {lecture.hall && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {lecture.hall}
              </span>
            )}
            {lecture.doctor && (
              <span className="inline-flex items-center gap-1">
                <User className="h-3.5 w-3.5" />
                {lecture.doctor}
              </span>
            )}
            {lecture.code && <span dir="ltr">{lecture.code}</span>}
          </div>

          {lecture.notes && (
            <p className="mt-2 text-sm text-muted-foreground">{lecture.notes}</p>
          )}

          {status === "upcoming" && (
            <p className="mt-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
              {tr("يبدأ بعد ", "Starts in ")}
              {Math.max(0, toMinutes(lecture.start_time) - (now.getHours() * 60 + now.getMinutes()))}{" "}
              {tr("دقيقة", "min")}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {onToggleAttendance && (
            <Button
              size="icon"
              variant={attended ? "default" : "outline"}
              className="h-9 w-9"
              onClick={onToggleAttendance}
              aria-label={
                attended ? tr("إلغاء الحضور", "Mark absent") : tr("تسجيل الحضور", "Mark present")
              }
              aria-pressed={attended}
            >
              {attended ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            </Button>
          )}

          {editMode && (
            <div className="flex gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9"
                onClick={onEdit}
                aria-label={tr("تعديل", "Edit")}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 text-destructive"
                onClick={onDelete}
                aria-label={tr("حذف", "Delete")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
