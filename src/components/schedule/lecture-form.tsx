"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { DAYS, LECTURE_COLORS, colorStyle } from "@/lib/constants";
import { findConflicts, lectureTitle } from "@/lib/schedule";
import { useList, useMutate } from "@/lib/db/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import type { Lecture } from "@/lib/db/types";

type Draft = Omit<Lecture, "id" | "created_date"> & { id?: string };

const EMPTY: Draft = {
  subject_name: "",
  subject_en: "",
  code: "",
  doctor: "",
  hall: "",
  day: 6,
  start_time: "08:00",
  end_time: "10:00",
  kind: "lecture",
  color: "indigo",
  notes: "",
  department: "عامة",
};

function ConflictWarning({ conflicts }: { conflicts: Lecture[] }) {
  const { tr, lang } = useI18n();
  if (!conflicts.length) return null;
  return (
    <div className="col-span-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700/60 dark:bg-amber-950/40">
      <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {tr(
          `تعارض مع ${conflicts.length} محاضرة في نفس الوقت:`,
          `Conflicts with ${conflicts.length} lecture(s) at the same time:`,
        )}
      </div>
      <ul className="mt-1.5 list-disc space-y-0.5 ps-5 text-amber-800 dark:text-amber-300/90">
        {conflicts.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2">
            <span className="truncate">{lectureTitle(c, lang)}</span>
            <span className="shrink-0 tabular-nums">
              {c.start_time} ← {c.end_time}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LectureFormDialog({
  open,
  lecture,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  lecture: Lecture | null;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const { tr } = useI18n();
  const { data: lectures = [] } = useList("Lecture", "-created_date", 300);
  const { create, update } = useMutate("Lecture");
  const [form, setForm] = useState<Draft>(EMPTY);
  const [error, setError] = useState("");
  const [custom, setCustom] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setSaving(false);
    if (lecture && lecture.id) {
      const { id, created_date: _cd, ...rest } = lecture;
      setForm({ ...EMPTY, ...rest, id });
      setCustom(
        Boolean(lecture.subject_name) &&
          !lectures.some((l) => l.subject_name === lecture.subject_name),
      );
    } else {
      setForm({ ...EMPTY, ...(lecture ?? {}) });
      setCustom(false);
    }
  }, [open, lecture, lectures]);

  const knownSubjects = useMemo(
    () =>
      Array.from(
        new Set(lectures.map((l) => l.subject_name).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b, "ar")),
    [lectures],
  );

  const conflicts = useMemo(
    () => findConflicts(lectures, form, form.id),
    [lectures, form],
  );

  const set = (key: keyof Draft) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.subject_name.trim()) {
      setError(tr("اكتب اسم المادة", "Enter the subject name"));
      return;
    }
    if (form.end_time <= form.start_time) {
      setError(
        tr(
          "وقت النهاية لازم يكون بعد وقت البداية",
          "End time must be after start time",
        ),
      );
      return;
    }
    setError("");
    setSaving(true);
    const { id, ...payload } = form;
    try {
      if (id) await update(id, { ...payload, day: Number(payload.day) });
      else await create({ ...payload, day: Number(payload.day) });
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("حصل خطأ", "Something went wrong"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">
            {form.id
              ? tr("تعديل محاضرة", "Edit lecture")
              : tr("محاضرة جديدة", "New lecture")}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="grid grid-cols-2 gap-4">
          <Field label={tr("اسم المادة", "Subject name")} className="col-span-2">
            <Select
              value={custom ? "__custom__" : form.subject_name}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__custom__") {
                  setCustom(true);
                  setForm((f) => ({ ...f, subject_name: "" }));
                } else {
                  setCustom(false);
                  setForm((f) => ({ ...f, subject_name: v }));
                }
              }}
            >
              <option value="">{tr("— اختر مادة —", "— Select subject —")}</option>
              {knownSubjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value="__custom__">
                {tr("أخرى — كتابة يدوية", "Other — type manually")}
              </option>
            </Select>
          </Field>

          {custom && (
            <Field
              label={tr("اسم المادة (يدوي)", "Subject name (manual)")}
              className="col-span-2"
            >
              <Input
                value={form.subject_name}
                onChange={set("subject_name")}
                placeholder={tr("اكتب اسم المادة", "Type subject name")}
                className="h-11 text-base"
              />
            </Field>
          )}

          <Field label={tr("الاسم بالإنجليزي", "English name")}>
            <Input
              value={form.subject_en}
              onChange={set("subject_en")}
              dir="ltr"
              className="h-11 text-base"
            />
          </Field>

          <Field label={tr("الكود", "Code")}>
            <Input
              value={form.code}
              onChange={set("code")}
              className="h-11 text-base"
            />
          </Field>

          <Field label={tr("الدكتور", "Doctor")}>
            <Input
              value={form.doctor}
              onChange={set("doctor")}
              className="h-11 text-base"
            />
          </Field>

          <Field label={tr("المدرج / المكان", "Hall / Place")}>
            <Input
              value={form.hall}
              onChange={set("hall")}
              className="h-11 text-base"
            />
          </Field>

          <Field label={tr("اليوم", "Day")}>
            <Select
              value={String(form.day)}
              onChange={(e) =>
                setForm((f) => ({ ...f, day: Number(e.target.value) }))
              }
            >
              {DAYS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.ar} / {d.en}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={tr("النوع", "Type")}>
            <Select
              value={form.kind}
              onChange={(e) =>
                setForm((f) => ({ ...f, kind: e.target.value as Draft["kind"] }))
              }
            >
              <option value="lecture">{tr("محاضرة", "Lecture")}</option>
              <option value="section">{tr("تمارين", "Section")}</option>
            </Select>
          </Field>

          <Field label={tr("من", "From")}>
            <Input
              type="time"
              value={form.start_time}
              onChange={set("start_time")}
              className="h-11 text-base"
            />
          </Field>

          <Field label={tr("إلى", "To")}>
            <Input
              type="time"
              value={form.end_time}
              onChange={set("end_time")}
              className="h-11 text-base"
            />
          </Field>

          <Field label={tr("اللون", "Color")} className="col-span-2">
            <div className="flex flex-wrap gap-2">
              {LECTURE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  aria-label={c}
                  aria-pressed={form.color === c}
                  className={`h-9 w-9 rounded-full ring-offset-2 ${
                    colorStyle(c).dot
                  } ${form.color === c ? "ring-2 ring-foreground" : ""}`}
                />
              ))}
            </div>
          </Field>

          <Field label={tr("ملاحظات", "Notes")} className="col-span-2">
            <Textarea
              value={form.notes}
              onChange={set("notes")}
              className="text-base"
            />
          </Field>

          <ConflictWarning conflicts={conflicts} />

          {error && (
            <p className="col-span-2 text-sm text-destructive">{error}</p>
          )}

          <div className="col-span-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {tr("إلغاء", "Cancel")}
            </Button>
            <Button type="submit" disabled={saving} className="h-12 text-base">
              {saving ? tr("بيتحفظ...", "Saving...") : tr("حفظ", "Save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
