"use client";

import { useI18n } from "@/lib/i18n";
import { useMutate } from "@/lib/db/store";
import { useAttendance } from "@/hooks/use-attendance";
import { useScheduleContext } from "@/lib/schedule-context";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { LectureCard } from "./lecture-card";
import type { Lecture } from "@/lib/db/types";

/** Picks the fields that make up a restorable lecture after an undo. */
const RESTORABLE: (keyof Lecture)[] = [
  "subject_name",
  "subject_en",
  "code",
  "doctor",
  "hall",
  "day",
  "start_time",
  "end_time",
  "kind",
  "color",
  "notes",
  "department",
];

const toPayload = (l: Lecture) =>
  Object.fromEntries(
    RESTORABLE.filter((k) => l[k] !== undefined && l[k] !== null).map((k) => [
      k,
      l[k],
    ]),
  ) as Partial<Lecture>;

export function LectureList({
  lectures,
  day,
  now,
}: {
  lectures: Lecture[];
  day: number;
  now: Date;
}) {
  const { tr } = useI18n();
  const { editMode, openForm } = useScheduleContext();
  const toast = useToast();
  const { remove, create } = useMutate("Lecture");
  const { isAttended, toggle } = useAttendance(now);

  const todays = lectures
    .filter((l) => Number(l.day) === Number(day))
    .sort(
      (a, b) =>
        a.start_time.localeCompare(b.start_time) ||
        a.end_time.localeCompare(b.end_time),
    );

if (!todays.length) {
    return (
      <div
        data-tour="lecture-list"
        className="rounded-2xl border border-dashed bg-card p-10 text-center text-muted-foreground"
      >
        <p className="font-medium">{tr("مفيش محاضرات في اليوم ده", "No lectures this day")}</p>
        {editMode && (
          <Button className="mt-3" onClick={() => openForm({ day } as Lecture)}>
            {tr("ضيف محاضرة", "Add a lecture")}
          </Button>
        )}
      </div>
    );
  }

return (
    <div data-tour="lecture-list" className="space-y-3">
      {todays.map((l) => (
        <LectureCard
          key={l.id}
          lecture={l}
          now={now}
          editMode={editMode}
          onEdit={() => openForm(l)}
          attended={isAttended(l)}
          onToggleAttendance={() => toggle(l)}
          onDelete={() => {
            const snapshot = l;
            void remove(l.id).then(() =>
              toast({
                title: tr("اتحذفت المحاضرة", "Lecture deleted"),
                description: l.subject_name,
                action: {
                  label: tr("تراجع", "Undo"),
                  onClick: () => {
                    void create(toPayload(snapshot));
                  },
                },
              }),
            );
          }}
        />
      ))}
    </div>
  );
}
