"use client";

import { useEffect, useMemo, useState } from "react";
import { GraduationCap, Pencil, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList, useMutate } from "@/lib/db/store";
import { GRADE_SCALE } from "@/lib/constants";
import { subjectCatalogue } from "@/lib/schedule";
import { useToast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { GpaWhatIf } from "@/components/gpa/what-if";
import { cn } from "@/lib/utils";
import type { Grade } from "@/lib/db/types";

const EMPTY = {
  subject_name: "",
  code: "",
  credit_hours: "3",
  letter: "A",
  semester: "",
};

type Draft = typeof EMPTY & { id?: string };

const pointFor = (letter: string) =>
  GRADE_SCALE.find((g) => g.l === letter)?.p ?? 0;

function GradeForm({
  open,
  onOpenChange,
  grade,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  grade: Grade | null;
}) {
  const { tr } = useI18n();
  const { create, update } = useMutate("Grade");
  const { data: lectures = [] } = useList("Lecture", "-created_date", 300);
  const { data: grades = [] } = useList("Grade");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDirty(false);
    setError("");
    setDraft(EMPTY);
    setCustom(false);
  }, [open, grade]);

  /**
   * The courses already in the schedule, so a course can be picked instead of
   * retyped. Grading is the second half of the same course: the code comes with
   * the name, and only the hours, the letter and the term are left to enter.
   */
  const catalogue = useMemo(() => subjectCatalogue(lectures), [lectures]);

  /** Courses already carrying a grade, so the same one is not entered twice. */
  const taken = useMemo(() => {
    const s = new Set(grades.map((g) => g.subject_name.trim().toLowerCase()));
    return s;
  }, [grades]);

  const effective: Draft = dirty
    ? draft
    : grade
      ? {
          subject_name: grade.subject_name,
          code: grade.code,
          credit_hours: String(grade.credit_hours),
          letter: grade.letter || "A",
          semester: grade.semester,
        }
      : EMPTY;

  const set = (k: keyof Draft) => (v: string) => {
    setDirty(true);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  const hours = Number(effective.credit_hours) || 0;
  const gpa = hours ? pointFor(effective.letter) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">
            {grade?.id
              ? tr("تعديل مادة", "Edit course")
              : tr("إضافة مادة", "Add course")}
          </DialogTitle>
        </DialogHeader>

        <form
          className="grid grid-cols-2 gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!effective.subject_name.trim()) {
              setError(tr("اكتب اسم المادة", "Enter the subject name"));
              return;
            }
            if (hours <= 0) {
              setError(tr("الساعات لازم تكون أكبر من صفر", "Credit hours must be above zero"));
              return;
            }
            if (gpa > 4) {
              setError(tr("المعدل ده كبير أوي", "That grade point is too high"));
              return;
            }
            setError("");
            const payload = {
              subject_name: effective.subject_name.trim(),
              code: effective.code,
              credit_hours: hours,
              letter: effective.letter,
              grade_point: gpa,
              semester: effective.semester,
            };
            if (grade?.id) await update(grade.id, payload);
            else await create(payload);
            setDirty(false);
            onOpenChange(false);
          }}
        >
          <Field label={tr("المادة", "Course")} className="col-span-2">
            {custom ? (
              <Input
                value={effective.subject_name}
                onChange={(e) => set("subject_name")(e.target.value)}
                className="h-11 text-base"
                autoFocus
                placeholder={tr("اكتب اسم المادة", "Type the course name")}
              />
            ) : (
              <Select
                value={effective.subject_name}
                onChange={(e) => {
                  const name = e.target.value;
                  if (name === "__custom__") {
                    setCustom(true);
                    setDirty(true);
                    setDraft((d) => ({ ...d, subject_name: "", code: "" }));
                    return;
                  }
                  // The code belongs to the course, not to the grade, so it
                  // comes along with the name instead of being retyped.
                  const source = catalogue.find((l) => l.subject_name === name);
                  setDirty(true);
                  setDraft((d) => ({
                    ...d,
                    subject_name: name,
                    code: source?.code || d.code,
                  }));
                }}
              >
                <option value="">{tr("— اختر مادة —", "— Select course —")}</option>
                {catalogue.map((l) => (
                  <option key={l.subject_name} value={l.subject_name}>
                    {l.subject_name}
                    {l.code ? ` (${l.code})` : ""}
                    {taken.has(l.subject_name.trim().toLowerCase())
                      ? ` — ${tr("مُضافة", "added")}`
                      : ""}
                  </option>
                ))}
                <option value="__custom__">
                  {tr("أخرى — كتابة يدوية", "Other — type manually")}
                </option>
              </Select>
            )}
          </Field>

          {custom && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="col-span-2 -mt-2 justify-self-start text-muted-foreground"
              onClick={() => {
                setCustom(false);
                setDirty(true);
                setDraft((d) => ({ ...d, subject_name: "", code: "" }));
              }}
            >
              {tr("اختار من مواد الجدول", "Pick from the schedule")}
            </Button>
          )}

          <Field label={tr("الكود", "Code")}>
            <Input
              value={effective.code}
              onChange={(e) => set("code")(e.target.value)}
              readOnly={!custom}
              placeholder={tr("يتملأ تلقائيًا", "filled in for you")}
              className="h-11 text-base"
            />
          </Field>

          <Field label={tr("الساعات", "Credit hours")}>
            <Input
              type="number"
              min={1}
              max={12}
              value={effective.credit_hours}
              onChange={(e) => set("credit_hours")(e.target.value)}
              className="h-11 text-base"
            />
          </Field>

          <Field label={tr("التقدير", "Grade")} className="col-span-2">
            <Select
              value={effective.letter}
              onChange={(e) => set("letter")(e.target.value)}
            >
              {GRADE_SCALE.map((g) => (
                <option key={g.l} value={g.l}>
                  {g.l} — {g.p.toFixed(1)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={tr("الترم", "Semester")} className="col-span-2">
            <Input
              value={effective.semester}
              onChange={(e) => set("semester")(e.target.value)}
              placeholder={tr("مثال: ترم أول", "e.g. Term 1")}
              className="h-11 text-base"
            />
          </Field>

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
            <Button type="submit" className="h-12 text-base">
              {tr("حفظ", "Save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function GpaPage() {
  const { tr } = useI18n();
  const toast = useToast();
  const { data: grades = [] } = useList("Grade");
  const { remove } = useMutate("Grade");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Grade | null>(null);

  const stats = useMemo(() => {
    let points = 0;
    let hours = 0;
    for (const g of grades) {
      const h = Number(g.credit_hours) || 0;
      points += h * (Number(g.grade_point) || 0);
      hours += h;
    }
    return { gpa: hours ? points / hours : 0, points, hours };
  }, [grades]);

  const letterTone = (p: number) =>
    p >= 3.5
      ? "bg-emerald-100 text-emerald-700"
      : p >= 2.5
        ? "bg-sky-100 text-sky-700"
        : p >= 1
          ? "bg-amber-100 text-amber-700"
          : "bg-rose-100 text-rose-700";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3" data-tour="gpa-header">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-[32px]">
            {tr("حاسبة المعدل", "GPA Calculator")}
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            {tr(
              "ضيف موادك وساعاتها وتقديراتها واحسب معدلك التراكمي تلقائيًا.",
              "Add your courses, credit hours and grades to compute your GPA automatically.",
            )}
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          className="shrink-0"
          data-tour="gpa-add"
        >
          <Plus className="h-4 w-4" /> {tr("إضافة مادة", "Add course")}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4" data-tour="gpa-stats">
        <div className="rounded-xl border bg-primary/5 p-3 text-center sm:rounded-2xl sm:p-5">
          <GraduationCap className="mx-auto h-6 w-6 text-primary sm:h-7 sm:w-7" />
          <p className="mt-1 text-[10px] text-muted-foreground sm:mt-2 sm:text-sm">
            {tr("المعدل", "GPA")}
          </p>
          <p className="font-display text-2xl font-bold tabular-nums text-primary sm:text-4xl">
            {stats.gpa.toFixed(2)}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-3 text-center sm:rounded-2xl sm:p-5">
          <p className="text-[10px] text-muted-foreground sm:text-sm">
            {tr("الساعات", "Hours")}
          </p>
          <p className="font-display text-2xl font-bold tabular-nums sm:text-4xl">
            {stats.hours}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-3 text-center sm:rounded-2xl sm:p-5">
          <p className="text-[10px] text-muted-foreground sm:text-sm">
            {tr("النقاط", "Points")}
          </p>
          <p className="font-display text-2xl font-bold tabular-nums sm:text-4xl">
            {stats.points.toFixed(1)}
          </p>
        </div>
      </div>

      <GpaWhatIf />

      {stats.hours > 0 && (
        <div className="rounded-2xl border p-4">
          <p className="text-sm font-semibold">
            {tr("التصنيف:", "Standing:")}
            <span className={cn("ms-2 rounded-full px-2 py-0.5 text-xs", letterTone(stats.gpa))}>
              {stats.gpa >= 3.5
                ? tr("ممتاز", "Excellent")
                : stats.gpa >= 3
                  ? tr("جيد جدًا", "Very good")
                  : stats.gpa >= 2
                    ? tr("جيد", "Good")
                    : tr("محتاج مجهود", "Needs work")}
            </span>
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, (stats.gpa / 4) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="space-y-2" data-tour="gpa-list">
        {grades.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            {tr(
              "لسه مفيش مواد — اضيف أول مادة عشان يبدأ الحساب.",
              "No courses yet — add your first course to start.",
            )}
          </p>
        ) : (
          grades.map((g) => (
            <div
              key={g.id}
              className="flex items-center gap-3 rounded-xl border bg-card p-3"
            >
              <span
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-bold",
                  letterTone(Number(g.grade_point)),
                )}
              >
                {g.letter || "—"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{g.subject_name}</p>
                <p className="text-xs text-muted-foreground">
                  {g.code && <span dir="ltr">{g.code} · </span>}
                  {tr("ساعات", "hours")} {g.credit_hours}
                  {g.semester && ` · ${g.semester}`}
                </p>
              </div>
              <span className="shrink-0 font-display text-lg font-bold tabular-nums text-primary">
                {(Number(g.grade_point) || 0).toFixed(1)}
              </span>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => {
                    setEditing(g);
                    setOpen(true);
                  }}
                  aria-label={tr("تعديل", "Edit")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive"
                  onClick={() =>
                    void remove(g.id).then(() =>
                      toast({ title: tr("اتحذفت الدرجة", "Grade removed") }),
                    )
                  }
                  aria-label={tr("حذف", "Delete")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <GradeForm
        open={open}
        onOpenChange={setOpen}
        grade={editing}
      />
    </div>
  );
}
