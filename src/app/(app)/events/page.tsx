"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList, useMutate } from "@/lib/db/store";
import { useToast } from "@/components/ui/toast";
import { EVENT_TYPES } from "@/lib/constants";
import { cn, isoDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { UniversityEvent } from "@/lib/db/types";

type Draft = {
  id?: string;
  title: string;
  title_en: string;
  date: string;
  type: UniversityEvent["type"];
  note: string;
};

const EMPTY: Draft = {
  title: "",
  title_en: "",
  date: "",
  type: "event",
  note: "",
};

function EventForm({
  open,
  onOpenChange,
  event,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  event: UniversityEvent | null;
}) {
  const { tr } = useI18n();
  const { create, update } = useMutate("UniversityEvent");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDirty(false);
    setError("");
    setDraft(EMPTY);
  }, [open, event]);

  const d: Draft = dirty
    ? draft
    : event
      ? {
          id: event.id,
          title: event.title,
          title_en: event.title_en,
          date: event.date,
          type: event.type,
          note: event.note,
        }
      : EMPTY;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDirty(true);
    setDraft((p) => ({ ...p, [k]: v }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">
            {d.id ? tr("تعديل مناسبة", "Edit event") : tr("إضافة مناسبة", "Add event")}
          </DialogTitle>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!d.title.trim()) {
              setError(tr("اكتب العنوان", "Enter a title"));
              return;
            }
            if (!d.date) {
              setError(tr("اختار التاريخ", "Pick a date"));
              return;
            }
            setError("");
            const payload = {
              title: d.title.trim(),
              title_en: d.title_en.trim(),
              date: d.date,
              type: d.type,
              note: d.note.trim(),
            };
            if (d.id) await update(d.id, payload);
            else await create(payload);
            setDirty(false);
            onOpenChange(false);
          }}
        >
          <Field label={tr("العنوان", "Title")}>
            <Input
              value={d.title}
              onChange={(e) => set("title", e.target.value)}
              className="h-11 text-base"
              autoFocus
            />
          </Field>

          <Field label={tr("العنوان بالإنجليزي", "Title (English)")}>
            <Input
              value={d.title_en}
              onChange={(e) => set("title_en", e.target.value)}
              className="h-11 text-base"
              dir="ltr"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label={tr("النوع", "Type")}>
              <Select
                value={d.type}
                onChange={(e) => set("type", e.target.value as Draft["type"])}
              >
                {EVENT_TYPES.map((t) => (
                  <option key={t.k} value={t.k}>
                    {tr(t.ar, t.en)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tr("التاريخ", "Date")}>
              <Input
                type="date"
                value={d.date}
                onChange={(e) => set("date", e.target.value)}
                className="h-11 text-base"
              />
            </Field>
          </div>

          <Field label={tr("تفاصيل", "Details")}>
            <Textarea
              value={d.note}
              onChange={(e) => set("note", e.target.value)}
              className="text-base"
              rows={3}
            />
          </Field>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
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

export default function EventsPage() {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data: events = [] } = useList("UniversityEvent", "date", 300);
  const { remove } = useMutate("UniversityEvent");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UniversityEvent | null>(null);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const locale = lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB";

  const { upcoming, past } = useMemo(() => {
    const today = isoDate(new Date());
    const up: UniversityEvent[] = [];
    const pa: UniversityEvent[] = [];
    for (const e of events) (e.date >= today ? up : pa).push(e);
    up.sort((a, b) => a.date.localeCompare(b.date));
    pa.sort((a, b) => b.date.localeCompare(a.date));
    return { upcoming: up, past: pa };
  }, [events]);

  const shown = tab === "upcoming" ? upcoming : past;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3" data-tour="events-header">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[32px] font-bold text-foreground">
            {tr("مناسبات الجامعة", "University events")}
          </h1>
          <p className="text-base text-muted-foreground">
            {tr(
              "الامتحانات والإجازات والإعلانات المهمة",
              "Exams, holidays and announcements that matter",
            )}
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          data-tour="events-add"
        >
          <Plus className="h-4 w-4" /> {tr("مناسبة جديدة", "New event")}
        </Button>
      </div>

      <div className="flex gap-1 rounded-xl border bg-card p-1" data-tour="events-tabs">
        {(["upcoming", "past"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "flex-1 rounded-lg py-2 text-sm font-bold transition-colors",
              tab === k ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {k === "upcoming" ? tr("جاية", "Upcoming") : tr("فاتت", "Past")}
            <span className="ms-1.5 opacity-70">
              {k === "upcoming" ? upcoming.length : past.length}
            </span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card p-10 text-center text-muted-foreground" data-tour="events-empty">
          {tr("مفيش مناسبات", "No events")}
        </p>
      ) : (
        <ul className="space-y-2" data-tour="events-list">
          {shown.map((e) => {
            const tone = EVENT_TYPES.find((t) => t.k === e.type) ?? EVENT_TYPES[3];
            const d = new Date(`${e.date}T00:00:00`);
            return (
              <li
                key={e.id}
                className="flex items-start gap-3 rounded-xl border bg-card p-3"
              >
                <div className="flex w-14 shrink-0 flex-col items-center rounded-lg bg-muted py-1.5">
                  <span className="font-display text-lg font-bold leading-none tabular-nums">
                    {d.getDate()}
                  </span>
                  <span className="text-[10px] uppercase text-muted-foreground">
                    {d.toLocaleDateString(locale, { month: "short" })}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                        tone.cls,
                      )}
                    >
                      {e.type === "announcement" && <Megaphone className="h-3 w-3" />}
                      {e.type === "event" && <CalendarDays className="h-3 w-3" />}
                      {tr(tone.ar, tone.en)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {d.toLocaleDateString(locale, { weekday: "long" })}
                    </span>
                  </div>
                  <p className="mt-0.5 font-semibold">
                    {lang === "en" ? e.title_en || e.title : e.title}
                  </p>
                  {e.note && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{e.note}</p>
                  )}
                </div>

                <div className="flex shrink-0 gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => {
                      setEditing(e);
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
                      void remove(e.id).then(() =>
                        toast({ title: tr("اتحذفت المناسبة", "Event deleted") }),
                      )
                    }
                    aria-label={tr("حذف", "Delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <EventForm open={open} onOpenChange={setOpen} event={editing} />
    </div>
  );
}
