"use client";

import { useI18n } from "@/lib/i18n";
import { DAYS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Lecture } from "@/lib/db/types";

export function DayTabs({
  value,
  onChange,
  lectures,
  today,
}: {
  value: number;
  onChange: (d: number) => void;
  lectures: Lecture[];
  today: number;
}) {
  const { tr, lang } = useI18n();

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-thin lg:mx-0 lg:px-0">
      {DAYS.map((d) => {
        const active = d.id === value;
        const isToday = d.id === today;
        const count = lectures.filter((l) => Number(l.day) === d.id).length;
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onChange(d.id)}
            aria-current={active ? "true" : undefined}
            className={cn(
              "flex min-w-[4.5rem] flex-col items-center gap-0.5 rounded-xl border px-3 py-2 transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card hover:bg-accent",
            )}
          >
            <span className="font-heading text-base font-bold">
              {lang === "en" ? d.enShort : d.arShort}
            </span>
            <span
              className={cn(
                "text-xs",
                active
                  ? "text-primary-foreground/80"
                  : isToday
                    ? "text-primary"
                    : "text-muted-foreground",
              )}
            >
              {isToday ? tr("النهارده", "Today") : `${count} ${tr("مواعيد", "slots")}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
