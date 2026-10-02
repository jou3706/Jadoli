"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Clock, MapPin, Pencil, Plus, Trash2, User } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList, useMutate } from "@/lib/db/store";
import { useScheduleContext } from "@/lib/schedule-context";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/input";
import { groupBySubject, lectureKindLabel, searchLectures } from "@/lib/schedule";
import { colorStyle, dayName } from "@/lib/constants";
import { cn, formatTime } from "@/lib/utils";
import { detectKind } from "@/lib/materials";
import { SubjectCoverTile } from "@/components/subjects/subject-cover";
import { AddMaterialRow } from "@/components/subjects/add-material-row";
import { SubjectMaterialsDialog } from "@/components/subjects/subject-materials-dialog";
import { SubjectEventsDialog } from "@/components/subjects/subject-events-dialog";
import { eventsForSubject } from "@/lib/subject-events";
import type { Lecture, Material, SubjectEvent } from "@/lib/db/types";

/* ── Subject card ──────────────────────────────────────────── */

function SubjectCard({
  name,
  sessions,
  materials,
  allMaterials,
}: {
  name: string;
  sessions: Lecture[];
  materials: Material[];
  /** Every material in the account, so any of them can be reused here. */
  allMaterials: Material[];
}) {
  const { tr, lang } = useI18n();
  const { editMode, openForm } = useScheduleContext();
  const toast = useToast();
  const { remove } = useMutate("Lecture");
  const { create: createMaterial } = useMutate("Material");
  const { data: subjects = [] } = useList("Subject");
  const { create: createSubject, update: updateSubject } = useMutate("Subject");
  const { data: allEvents = [] } = useList("SubjectEvent", "date", 500);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);

  // The count on the button, so a course with something due is visible without
  // opening anything. Matched the same way the schedule matches it.
  const eventCount = useMemo(
    () => eventsForSubject(allEvents as SubjectEvent[], name).length,
    [allEvents, name],
  );

  const first = sessions[0] ?? materials[0];
  const en = sessions[0]?.subject_en ?? "";
  const c = colorStyle(first?.color ?? "indigo");
  const row = subjects.find((s) => s.name === name) ?? null;

  const totalHours = sessions.reduce((acc, l) => {
    const [sh, sm] = l.start_time.split(":").map(Number);
    const [eh, em] = l.end_time.split(":").map(Number);
    return acc + (eh * 60 + em - (sh * 60 + sm)) / 60;
  }, 0);

  /** Cover images live on a subjects row; create it on first use. */
  function setCover(imageUrl: string, credit = "") {
    if (row) {
      void updateSubject(row.id, { image_url: imageUrl, image_credit: credit }).catch(() => {});
    } else {
      void createSubject({ name, image_url: imageUrl, image_credit: credit }).catch(() => {});
    }
  }

  /**
   * Guarantees one subjects row per course. Two files dropped in a row race on
   * the (user_id, name) unique index, and a duplicate is not a real failure —
   * the row already exists and the next read picks it up.
   */
  function ensureRow() {
    if (!row) void createSubject({ name, image_url: "", image_credit: "" }).catch(() => {});
  }

  function addFile(f: { path: string; url: string; title: string; size: number }) {
    ensureRow();
    void createMaterial({
      title: f.title,
      subject_key: name,
      url: f.url,
      type: detectKind(f.url),
      file_path: f.path,
      size: f.size,
    }).catch((e: Error) =>
      toast({
        title: tr("فشل حفظ المادة", "Could not save"),
        description: e.message,
        variant: "destructive",
      }),
    );
  }

  function addLink(url: string) {
    ensureRow();
    const title = decodeURIComponent(url.split("/").pop()?.split("?")[0] || url);
    void createMaterial({
      title: title.slice(0, 80),
      subject_key: name,
      url,
      type: detectKind(url),
      file_path: "",
      size: 0,
    }).catch((e: Error) =>
      toast({
        title: tr("فشل حفظ المادة", "Could not save"),
        description: e.message,
        variant: "destructive",
      }),
    );
    toast({ title: tr("اتضافت المادة", "Material added") });
  }

  /**
   * Copies a material the account already holds into this subject. The original
   * keeps its own row, so both subjects share the file without owning it — which
   * is why deleting one must not remove the file.
   */
  function reuseMaterial(m: Material) {
    // The picker marks what is already here, but a double click can still land
    // two copies, and the unique index would reject the second one anyway.
    if (materials.some((x) => x.id === m.id)) return;
    ensureRow();
    void createMaterial({
      title: m.title,
      subject_key: name,
      url: m.url,
      type: m.type,
      file_path: m.file_path,
      size: m.size,
    })
      .then(() => toast({ title: tr("اتضافت المادة", "Material added") }))
      .catch((e: Error) =>
        toast({
          title: tr("فشل حفظ المادة", "Could not save"),
          description: e.message,
          variant: "destructive",
        }),
      );
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-start gap-3 p-4">
        {/* The cover keeps its own pick/AI/remove buttons. */}
        <SubjectCoverTile
          name={name}
          subject={row}
          onSave={setCover}
          onRemove={() => setCover("")}
        />

        {/* Clicking the name opens this subject's materials. */}
        <button
          type="button"
          onClick={() => setMaterialsOpen(true)}
          className="min-w-0 flex-1 text-start transition-opacity hover:opacity-70"
        >
          <h3 className="truncate font-display text-lg font-bold">{name}</h3>
          {en && (
            <p className="truncate text-xs opacity-80" dir="auto">
              {en}
            </p>
          )}
          {row?.image_credit && (
            <p className="mt-0.5 truncate text-[10px] opacity-70" title={row.image_credit}>
              📷 {row.image_credit}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-bold",
                c.text,
                "bg-background/60",
              )}
            >
              {sessions.length} {tr("محاضرة", "lectures")}
            </span>
            <span
              className={cn(
                "rounded-full bg-background/60 px-2 py-0.5 font-bold",
                materials.length > 0 && "underline decoration-dotted underline-offset-2",
              )}
            >
              {materials.length} {tr("مادة", "materials")}
            </span>
            {totalHours > 0 && (
              <span className="inline-flex items-center gap-1 opacity-80">
                <Clock className="h-3 w-3" />
                {totalHours.toFixed(1)}
              </span>
            )}
          </div>
        </button>
      </div>

      {sessions.length > 0 && (
        <ul className="divide-y border-t">
          {sessions.map((l) => (
            <li key={l.id} className="flex items-start gap-3 p-3 text-sm">
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded-md px-2 py-1 text-center text-xs font-bold",
                  c.soft,
                  c.text,
                )}
              >
                {dayName(Number(l.day), lang)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="tabular-nums font-semibold">
                  {formatTime(l.start_time)} — {formatTime(l.end_time)}
                  {l.kind === "section" && (
                    <span className="ms-2 text-xs font-normal text-muted-foreground">
                      {lectureKindLabel(l.kind, lang)}
                    </span>
                  )}
                </p>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {l.hall && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {l.hall}
                    </span>
                  )}
                  {l.doctor && (
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {l.doctor}
                    </span>
                  )}
                  {l.code && <span dir="ltr">{l.code}</span>}
                </div>
                {l.notes && <p className="mt-1 text-xs text-muted-foreground">{l.notes}</p>}
              </div>
              {editMode && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => openForm(l)}
                    aria-label={tr("تعديل", "Edit")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive"
                    onClick={() =>
                      void remove(l.id).then(() =>
                        toast({
                          title: tr("اتحذفت المحاضرة", "Lecture deleted"),
                          description: l.subject_name,
                        }),
                      )
                    }
                    aria-label={tr("حذف", "Delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* the drop target: drag a file from the desktop onto this row */}
      <AddMaterialRow subjectKey={name} onAdd={addFile} onAddLink={addLink} />

      <div className="flex items-center gap-1 border-t">
        <button
          type="button"
          onClick={() => setMaterialsOpen(true)}
          className="flex flex-1 items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-primary"
        >
          <Plus className="h-3 w-3" />
          {materials.length > 0
            ? tr("إدارة المواد", "Manage materials")
            : tr("أضف مادة", "Add a material")}
        </button>
        <span className="h-4 w-px bg-border" />
        <button
          type="button"
          onClick={() => setEventsOpen(true)}
          className="flex flex-1 items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-primary"
        >
          <CalendarClock className="h-3 w-3" />
          {eventCount > 0
            ? tr(`الأحداث (${eventCount})`, `Events (${eventCount})`)
            : tr("أضف حدث", "Add an event")}
        </button>
      </div>

      <SubjectMaterialsDialog
        open={materialsOpen}
        onOpenChange={setMaterialsOpen}
        name={name}
        materials={materials}
        allMaterials={allMaterials}
        onReuse={reuseMaterial}
        onAdd={addFile}
        onAddLink={addLink}
      />

      <SubjectEventsDialog
        open={eventsOpen}
        onOpenChange={setEventsOpen}
        subject={name}
      />
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────── */

export default function SubjectsPage() {
  const { tr } = useI18n();
  const { search } = useScheduleContext();
  const { data: lectures = [], isLoading } = useList("Lecture", "-created_date", 300);
  const { data: materials = [] } = useList("Material", "-created_date", 500);

  const groups = useMemo(
    () => groupBySubject(searchLectures(lectures, search)),
    [lectures, search],
  );

  /** Materials matched to their course; the same list can hold loose rows. */
  const bySubject = useMemo(() => {
    const map = new Map<string, Material[]>();
    for (const m of materials) {
      const key = (m.subject_key || "").trim();
      if (!key) continue;
      const list = map.get(key);
      if (list) list.push(m);
      else map.set(key, [m]);
    }
    return map;
  }, [materials]);

  /** Show a card for a course that only has materials but no lectures yet. */
  const names = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of groups) {
      const key = (g[0]?.subject_name || "").trim();
      if (key) seen.set(key.toLowerCase(), key);
    }
    for (const key of bySubject.keys()) seen.set(key.toLowerCase(), key);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [groups, bySubject]);

  const loose = materials.filter((m) => !(m.subject_key || "").trim()).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-[32px] font-bold text-foreground">
          {tr("موادي", "My subjects")}
        </h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          {tr(
            "اضغط على اسم المادة تشوف موادها، أو اسحب أي ملف من الجهاز على سطر «إضافة مادة».",
            "Click a subject to see its materials, or drag a file onto the Add Material row.",
          )}
        </p>
      </div>

      {isLoading && <Skeleton className="h-40" />}

      {!isLoading && names.length === 0 && (
        <div className="rounded-2xl border border-dashed bg-card p-10 text-center text-muted-foreground">
          {tr("مفيش مواد الدراسية", "No subjects yet")}
        </div>
      )}

      {loose > 0 && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-600">
          {loose} {tr("مادة لسه مش متربوطة بمادة", "materials are not filed under a subject yet")}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {names.map((name) => (
      <SubjectCard
        key={name}
        name={name}
        sessions={groups.find((g) => g[0]?.subject_name === name) ?? []}
        materials={bySubject.get(name) ?? []}
        allMaterials={materials}
      />
    ))}
      </div>
    </div>
  );
}
