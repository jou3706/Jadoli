"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, Loader2, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList, useMutate } from "@/lib/db/store";
import { authHeader } from "@/lib/db/supabase-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { isDuplicateEvent, kindClass, kindLabel, shortDate } from "@/lib/subject-events";
import { sameEvent, type SyllabusDraft } from "@/lib/ai/syllabus";
import { cn } from "@/lib/utils";
import type { Material } from "@/lib/db/types";

/**
 * Read a syllabus, check what it said, keep what is right.
 *
 * Nothing is written until the student confirms. The rows arrive with the dates
 * the model managed to resolve, and a course the model could not name is asked
 * for rather than guessed, because an event filed under the wrong course is
 * filed where nobody will look for it.
 */
export function SyllabusDialog({
  open,
  onOpenChange,
  material,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  material: Material | null;
}) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data: existing = [] } = useList("SubjectEvent", "date", 500);
  const { create } = useMutate("SubjectEvent");

  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<SyllabusDraft[]>([]);
  const [dropped, setDropped] = useState<number[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setDrafts([]);
    setDropped([]);
    setErr("");
    if (material) void read(material);
    // Re-reading on every open would spend a call each time the dialog is
    // closed by accident, which is the common way it gets closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, material?.id]);

  const read = async (m: Material) => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/ai/syllabus", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          materialId: m.id,
          subject: m.subject_key ?? "",
          language: lang === "en" ? "en" : "ar",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.reason || data.error || "read failed");
      }
      const events: SyllabusDraft[] = Array.isArray(data.events) ? data.events : [];
      setDrafts(events);
      if (!events.length) {
        setErr(
          tr(
            "مالقتش مواعيد بتاريخ واضح في الملف ده.",
            "No clearly dated events in that file.",
          ),
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** A row the student can edit before it is kept. */
  const patch = (i: number, next: Partial<SyllabusDraft>) =>
    setDrafts((ds) => ds.map((d, k) => (k === i ? { ...d, ...next } : d)));

  const rows = useMemo(
    () =>
      drafts
        .map((row, i) => ({ row, i }))
        .filter(({ i }) => !dropped.includes(i)),
    [drafts, dropped],
  );

  const save = async () => {
    if (!rows.length) return;
    if (rows.every(({ row }) => !row.subject_key.trim() || !row.title.trim())) {
      toast({
        title: tr("محتاج اسم ومادة لكل حدث", "Each event needs a title and a course"),
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    let made = 0;
    let already = 0;
    try {
      for (const { row } of rows) {
        const key = row.subject_key.trim();
        if (!key) continue;
        if (existing.some((e) => sameEvent(e, { ...row, subject_key: key }))) {
          already += 1;
          continue;
        }
        try {
          await create({
            subject_key: key,
            title: row.title,
            kind: row.kind,
            date: row.date,
            start_time: row.start_time,
            end_time: row.end_time,
            hall: row.hall,
            note: row.note,
            remind_minutes: row.remind_minutes,
          });
          made += 1;
        } catch (e) {
          // The database refuses a second copy of the same event on the same day.
          if (isDuplicateEvent(e)) {
            already += 1;
            continue;
          }
          throw e;
        }
      }
      toast({
        title:
          made > 0
            ? tr(`اتسجل ${made} حدث`, `${made} event${made === 1 ? "" : "s"} added`)
            : tr("كل الأحداث موجودة خلاص", "Everything was already on the calendar"),
        description:
          already > 0
            ? tr(`${already} منهم كان مسجل`, `${already} of them were already there`)
            : undefined,
      });
      if (made > 0) onOpenChange(false);
    } catch (e) {
      toast({
        title: tr("مقدرناش نسجل الأحداث", "Could not save the events"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">
            <span className="inline-flex items-center gap-2">
              <CalendarPlus className="h-5 w-5 text-primary" />
              {tr("مواعيد من الـsyllabus", "Dates from the syllabus")}
            </span>
          </DialogTitle>
        </DialogHeader>

        {busy ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {tr("بقرأ الملف…", "Reading the file…")}
          </div>
        ) : err && !drafts.length ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            {err}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              {tr(
                "راجع المواعيد دي قبل ما تتحفظ — عدّل أي حاجة مش مظبوطة.",
                "Check these before they are saved — edit anything that is off.",
              )}
            </p>

            {rows.map(({ row, i }) => (
              <div key={i} className="space-y-2 rounded-xl border p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={row.title}
                    onChange={(e) => patch(i, { title: e.target.value })}
                    className="h-9 flex-1"
                    aria-label={tr("اسم الحدث", "Event title")}
                  />
                  <span className={cn("rounded-full px-2 py-0.5 text-xs", kindClass(row.kind))}>
                    {kindLabel(row.kind, lang === "en" ? "en" : "ar")}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    type="date"
                    value={row.date}
                    onChange={(e) => patch(i, { date: e.target.value })}
                    className="h-9"
                    aria-label={tr("التاريخ", "Date")}
                  />
                  <Input
                    type="time"
                    value={row.start_time}
                    onChange={(e) => patch(i, { start_time: e.target.value })}
                    className="h-9"
                    aria-label={tr("الوقت", "Time")}
                  />
                  <Input
                    value={row.subject_key}
                    onChange={(e) => patch(i, { subject_key: e.target.value })}
                    className="h-9"
                    aria-label={tr("المادة", "Course")}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-muted-foreground">
                    {shortDate(row.date, lang === "en" ? "en" : "ar")}
                    {row.hall ? ` · ${row.hall}` : ""}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setDropped((d) => [...d, i])}
                  >
                    {tr("اتخطّى", "Skip")}
                  </Button>
                </div>
              </div>
            ))}

            <Button onClick={save} disabled={saving || !rows.length} className="w-full">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CalendarPlus className="h-4 w-4" />
              )}
              {tr("احفظ المواعيد", "Save the dates")}
            </Button>

            {!!dropped.length && (
              <button
                type="button"
                className="w-full text-xs text-muted-foreground underline"
                onClick={() => setDropped([])}
              >
                {tr(`رجّع ${dropped.length} اتشال`, `Restore ${dropped.length} skipped`)}
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}