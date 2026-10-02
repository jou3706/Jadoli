"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList, useMutate } from "@/lib/db/store";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { cn, formatTime } from "@/lib/utils";
import {
  EVENT_KINDS,
  countdownLabel,
  eventsForSubject,
  isDuplicateEvent,
  kindClass,
  kindLabel,
  shortDate,
  splitByToday,
  todayISO,
} from "@/lib/subject-events";
import type { SubjectEvent, SubjectEventKind } from "@/lib/db/types";

/**
 * A course's quizzes and exams: add one, and see what is already there.
 *
 * An event carries a real date rather than a weekday, because an exam is "the
 * 14th" and not "Tuesday" - the whole point is knowing how far away it is.
 */

/** The fields needed to put the event back after it is deleted. */
const RESTORABLE: (keyof SubjectEvent)[] = [
  "subject_key",
  "title",
  "kind",
  "date",
  "start_time",
  "end_time",
  "hall",
  "note",
];

const toPayload = (e: SubjectEvent) =>
  Object.fromEntries(
    RESTORABLE.filter((k) => e[k] !== undefined && e[k] !== null).map((k) => [k, e[k]]),
  ) as Partial<SubjectEvent>;

function EventRow({
  event,
  today,
  onDelete,
}: {
  event: SubjectEvent;
  today: string;
  onDelete: () => void;
}) {
  const { tr, lang } = useI18n();
  const past = event.date < today;

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3",
        past && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold",
              kindClass(event.kind),
            )}
          >
            {kindLabel(event.kind, lang)}
          </span>
          <span className="font-bold">{event.title}</span>
          <span className="text-xs text-muted-foreground">
            {shortDate(event.date, lang)} · {countdownLabel(event.date, today, lang)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          {event.start_time && (
            <span className="tabular-nums">
              {formatTime(event.start_time)}
              {event.end_time && ` — ${formatTime(event.end_time)}`}
            </span>
          )}
          {event.hall && <span>{event.hall}</span>}
        </div>
        {event.note && <p className="mt-1 text-xs">{event.note}</p>}
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 shrink-0 text-destructive"
        onClick={onDelete}
        aria-label={tr("حذف الحدث", "Delete event")}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

export function SubjectEventsDialog({
  open,
  onOpenChange,
  subject,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  subject: string;
}) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const today = todayISO(new Date());
  const { data: all = [] } = useList("SubjectEvent", "date", 500);
  const { create, remove } = useMutate("SubjectEvent");

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<SubjectEventKind>("quiz");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [hall, setHall] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const events = useMemo(() => eventsForSubject(all, subject), [all, subject]);
  const { upcoming } = useMemo(() => splitByToday(events, today), [events, today]);

  const reset = () => {
    setTitle("");
    setKind("quiz");
    setDate("");
    setStart("");
    setEnd("");
    setHall("");
    setNote("");
  };

  const save = async () => {
    // A date is the one thing that cannot be guessed: an event without one
    // could not be counted down to, which is what it is for.
    if (!title.trim() || !date) return;
    setSaving(true);
    try {
      await create({
        subject_key: subject,
        title: title.trim(),
        kind,
        date,
        start_time: start,
        end_time: end,
        hall: hall.trim(),
        note: note.trim(),
      });
      reset();
      toast({ title: tr("اتسجل الحدث", "Event added"), description: title.trim() });
    } catch (e) {
      // The database refuses a second copy of the same event on the same day.
      // That is worth saying plainly: it is not a failure, it is the row the
      // person was trying to make.
      if (isDuplicateEvent(e)) {
        toast({
          title: tr("الحدث مسجل خلاص", "That event is already there"),
          description: title.trim(),
        });
        return;
      }
      toast({
        title: tr("مقدرتش تحفظ الحدث", "Could not save the event"),
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const del = async (event: SubjectEvent) => {
    try {
      await remove(event.id);
      // An undo is a new row rather than a resurrection: the id is gone, and a
      // row that comes back with a fresh one is a row the database is happy
      // with. The unique index is what keeps the two from ever sitting side by
      // side, so a delete that was still queued offline cannot come back as a
      // second copy.
      toast({
        title: tr("اتحذف الحدث", "Event deleted"),
        description: event.title,
        action: {
          label: tr("تراجع", "Undo"),
          onClick: () => {
            void create(toPayload(event)).catch(() =>
              toast({
                title: tr("مقدرناش نرجّعه", "Could not bring it back"),
                variant: "destructive",
              }),
            );
          },
        },
      });
    } catch (e) {
      toast({
        title: tr("مقدرناش نحذف", "Could not delete"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {tr("أحداث ", "Events · ")}
            <span className="text-muted-foreground">{subject}</span>
          </DialogTitle>
          {upcoming.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {tr("فاضل ", "Next up: ")}
              <span className="font-bold text-foreground">
                {upcoming[0].title} · {countdownLabel(upcoming[0].date, today, lang)}
              </span>
            </p>
          )}
        </DialogHeader>

        <div className="grid gap-3">
          <Field label={tr("الحدث", "Event")}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={tr("مثال: كويز نص الفصل", "e.g. Mid-term quiz")}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={tr("النوع", "Type")}>
              <Select value={kind} onChange={(e) => setKind(e.target.value as SubjectEventKind)}>
                {EVENT_KINDS.map((k) => (
                  <option key={k.k} value={k.k}>
                    {lang === "en" ? k.en : k.ar}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tr("التاريخ", "Date")}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={tr("من", "From")}>
              <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label={tr("إلى", "To")}>
              <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>

          <Field label={tr("القاعة", "Hall")}>
            <Input value={hall} onChange={(e) => setHall(e.target.value)} />
          </Field>

          <Field label={tr("ملاحظة", "Note")}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </Field>

          <Button onClick={save} disabled={saving || !title.trim() || !date}>
            <CalendarPlus className="h-4 w-4" />
            {saving ? tr("بيحفظ…", "Saving…") : tr("ضيف الحدث", "Add event")}
          </Button>
          {!date && title.trim() && (
            <p className="text-xs text-muted-foreground">
              {tr("اختار تاريخ الأول", "Pick a date first")}
            </p>
          )}
        </div>

        {events.length > 0 && (
          <>
            <h4 className="mt-2 text-sm font-bold">
              {tr("المسجل", "Already added")}
            </h4>
            <ul className="space-y-2">
              {events.map((e) => (
                <EventRow
                  key={e.id}
                  event={e}
                  today={today}
                  onDelete={() => void del(e)}
                />
              ))}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}