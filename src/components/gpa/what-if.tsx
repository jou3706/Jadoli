"use client";

import { useMemo, useState } from "react";
import { Calculator } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList } from "@/lib/db/store";
import { GRADE_SCALE } from "@/lib/constants";
import { gpaTotals, gpaWith, gradeNeeded } from "@/lib/gpa";
import { Field, Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const HOURS = ["1", "2", "3", "4", "5", "6"];

/**
 * The other half of the calculator.
 *
 * The page adds up what has already been graded; this asks what one more course
 * does to it — which is the question a student actually has halfway through a
 * term. Nothing here is saved: a what-if that wrote to the grade list would have
 * to be undone by hand, and the whole point is to be free to try.
 */
export function GpaWhatIf() {
  const { tr } = useI18n();
  const { data: grades = [] } = useList("Grade");
  const [hours, setHours] = useState("3");
  const [letter, setLetter] = useState("B+");
  const [target, setTarget] = useState("3.0");

  const now = useMemo(() => gpaTotals(grades), [grades]);
  const h = Number(hours) || 0;
  const targetGpa = Number(target);

  const projected = useMemo(
    () => (h > 0 ? gpaWith(grades, h, letter) : null),
    [grades, h, letter],
  );
  const needed = useMemo(
    () => (h > 0 && Number.isFinite(targetGpa) && targetGpa > 0 ? gradeNeeded(grades, h, targetGpa) : null),
    [grades, h, targetGpa],
  );

  const delta = projected === null || !now.hours ? 0 : projected - now.gpa;

  return (
    <div className="space-y-3 rounded-2xl border bg-card p-4" data-tour="gpa-whatif">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Calculator className="h-4 w-4 text-primary" />
        {tr("لو جبت إيه هيعمل إيه في معدلك؟", "What would one more course do?")}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label={tr("ساعات المادة", "Course hours")}>
          <Select value={hours} onChange={(e) => setHours(e.target.value)}>
            {HOURS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("التقدير", "Grade")}>
          <Select value={letter} onChange={(e) => setLetter(e.target.value)}>
            {GRADE_SCALE.map((g) => (
              <option key={g.l} value={g.l}>
                {g.l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("المعدل اللي عايز توصله", "Target GPA")} className="col-span-2 sm:col-span-1">
          <Input
            value={target}
            inputMode="decimal"
            onChange={(e) => setTarget(e.target.value)}
            placeholder="3.0"
          />
        </Field>
      </div>

      {now.hours > 0 && projected !== null ? (
        <div className="rounded-xl border bg-background p-3">
          <p className="text-sm">
            {tr("لو جبت", "A")} <span className="font-semibold">{letter}</span>{" "}
            {tr("في", "on")} {h} {tr("ساعات، معدلك يبقى", "hours, your GPA becomes")}{" "}
            <span className="font-display text-base font-bold tabular-nums text-primary">
              {projected.toFixed(2)}
            </span>
          </p>
{Math.abs(delta) > 0.005 && (
              <p
                className={cn(
                  "mt-1 text-xs font-medium",
                  delta > 0 ? "text-emerald-600" : "text-rose-600",
                )}
              >
                {delta > 0 ? "+" : ""}
                {delta.toFixed(2)} {tr("مقارنةً بمعدلك الحالي", "from your current")}{" "}
                {now.gpa.toFixed(2)}
              </p>
            )}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed bg-background p-3 text-center text-xs text-muted-foreground">
          {tr(
            "ضيف موادك الأول عشان تقدر تقارن.",
            "Add your graded courses first, then this has something to compare against.",
          )}
        </p>
      )}

      {needed && (
        <p className="text-xs text-muted-foreground">
          {needed.reachable ? (
            <>
              {tr("أقل تقدير يوصلك", "The lowest grade that keeps you at")}{" "}
              <span className="font-semibold text-foreground">{targetGpa.toFixed(2)}</span>{" "}
              {tr("في", "on")} {h} {tr("ساعات هو", "hours is")}{" "}
              <span className="font-semibold text-foreground">{needed.letter}</span>
              {tr("، والمعدل هيبقى", ", which averages")}{" "}
              <span className="font-semibold text-foreground">{needed.gpa.toFixed(2)}</span>
            </>
          ) : (
            tr(
              `مفيش تقدير في ${h} ساعات يوصلك ${targetGpa.toFixed(2)} — أقصى حاجة A بتدي ${needed.gpa.toFixed(2)}.`,
              `No grade on ${h} hours reaches ${targetGpa.toFixed(2)} — even an A averages ${needed.gpa.toFixed(2)}.`,
            )
          )}
        </p>
      )}
    </div>
  );
}