"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  FileText,
  ImageIcon,
  Loader2,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList, useMutate } from "@/lib/db/store";
import { authHeader } from "@/lib/db/supabase-client";
import { dayName, LECTURE_COLORS } from "@/lib/constants";
import { formatTime } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  draftKey,
  emptyPreview,
  keptRows,
  removeAt,
  removedRows,
  renameAt,
  restoreAll,
  restoreAt,
  type Draft,
  type Preview,
} from "@/lib/import-drafts";

const toDraft = (r: Record<string, unknown>, i: number): Draft => ({
  subject_name: String(r.subject_name ?? ""),
  subject_en: String(r.subject_en ?? ""),
  code: String(r.code ?? ""),
  doctor: String(r.doctor ?? ""),
  hall: String(r.hall ?? ""),
  day: Number(r.day),
  start_time: String(r.start_time ?? ""),
  end_time: String(r.end_time ?? ""),
  kind: r.kind === "section" ? "section" : "lecture",
  notes: String(r.notes ?? ""),
  department: String(r.department ?? ""),
  color: LECTURE_COLORS[i % LECTURE_COLORS.length],
});

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });

export default function ImportPage() {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data: existing = [] } = useList("Lecture", "-created_date", 300);
  const { bulkCreate, deleteMany } = useMutate("Lecture");
  const [files, setFiles] = useState<{ name: string; uri: string }[]>([]);
  const [preview, setPreview] = useState<Preview>(emptyPreview());
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const kept = useMemo(() => keptRows(preview), [preview]);
  const gone = useMemo(() => removedRows(preview), [preview]);

  const duplicates = useMemo(() => {
    const have = new Set(existing.map((l) => draftKey(l as unknown as Draft)));
    return new Set(preview.all.map((d, i) => (have.has(draftKey(d)) ? i : -1)).filter((i) => i >= 0));
  }, [preview, existing]);

  /**
   * Takes a row out of the list but keeps it, and says so. The user is
   * reviewing a read of a photograph, so a row taken out is a guess about
   * what the assistant misread - it needs to be reversible before saving,
   * not a deletion.
   */
  const drop = (i: number) => {
    setPreview((p) => removeAt(p, i));
    const name = preview.all[i]?.subject_name;
    toast({
      title: tr("اتشالت المحاضرة", "Lecture removed"),
      description: name,
      action: {
        label: tr("رجّعها", "Undo"),
        onClick: () => setPreview((p) => restoreAt(p, i)),
      },
    });
  };

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const next: { name: string; uri: string }[] = [];
    for (const f of Array.from(list).slice(0, 8)) {
      const ok = f.type.startsWith("image/") || f.type === "application/pdf";
      if (!ok) continue;
      if (f.size > 15 * 1024 * 1024) {
        toast({
          title: `${f.name}: ${tr("الملف كبير أوي", "file is too large")}`,
          variant: "destructive",
        });
        continue;
      }
      next.push({ name: f.name, uri: await readAsDataUrl(f) });
    }
    setFiles((p) => [...p, ...next].slice(0, 8));
    if (inputRef.current) inputRef.current.value = "";
  };

  const run = async () => {
    if (!files.length) return;
    setBusy(true);
    setError("");
    setPreview(emptyPreview());
    try {
      const res = await fetch("/api/ai/import", {
        method: "POST",
        // This route reads no file, so nothing else here would identify the
        // caller: without the token it refuses, and the import never runs.
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          images: files.map((f) => ({
            dataUrl: f.uri,
            mime: f.uri.match(/^data:([^;]+);/)?.[1] ?? "image/png",
          })),
        }),
      });
      const json = (await res.json()) as { lectures?: Record<string, unknown>[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "request failed");
      const rows = (json.lectures ?? []).map(toDraft);
      if (!rows.length) {
        setError(
          tr(
            "ما قدرتش أقرا الجدول — جرّب صورة أوضح أو زاوية تانية.",
            "Could not read the timetable — try a clearer photo or a different angle.",
          ),
        );
        return;
      }
      setPreview({ all: rows, removed: [] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!kept.length) return;
    setBusy(true);
    try {
      // A second photo of the same timetable must not double the schedule, so
      // anything already in the table is skipped unless the user asked for a
      // full replace. `existing` is the user's own rows only, thanks to RLS.
      // Saved from the kept rows, so a row the user removed stays out even
      // though it is still held for undo.
      const rows = kept.map(({ row }) => row);
      const have = new Set(existing.map((l) => draftKey(l as unknown as Draft)));
      const skipped = replace ? 0 : rows.filter((d) => have.has(draftKey(d))).length;
      const fresh = replace ? rows : rows.filter((d) => !have.has(draftKey(d)));

      if (replace) await deleteMany({}, { all: true });
      if (fresh.length) {
        await bulkCreate(
          fresh.map((d) => ({
            ...d,
            subject_name: d.subject_name.trim(),
            notes: d.notes.trim(),
          })),
        );
      }
      toast({
        title: tr(`تم إضافة ${fresh.length} محاضرة`, `Added ${fresh.length} lectures`),
        description: skipped
          ? tr(
              `${skipped} محاضرة موجودة بالفعل واتسابت`,
              `${skipped} already in the schedule were skipped`,
            )
          : undefined,
      });
      setPreview(emptyPreview());
      setFiles([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div data-tour="import-header">
        <h1 className="font-display text-[32px] font-bold text-foreground">
          {tr("استيراد الجدول", "Import schedule")}
        </h1>
        <p className="text-base text-muted-foreground">
          {tr(
            "ارفع صورة الجدول أو الـ PDF والمساعد يقراه ويملأ الجدول لوحده.",
            "Upload a photo of your timetable or the PDF and the assistant fills the schedule for you.",
          )}
        </p>
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addFiles(e.dataTransfer.files);
        }}
        className="rounded-2xl border-2 border-dashed bg-card p-6 text-center"
        data-tour="import-drop"
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          hidden
          onChange={(e) => void addFiles(e.target.files)}
        />
        <Upload className="mx-auto h-8 w-8 text-primary" />
        <p className="mt-2 font-semibold">
          {tr("اسحب الصور هنا أو اختارها", "Drag images here or choose files")}
        </p>
        <p className="text-xs text-muted-foreground">
          {tr(
            "صور أو PDF — 8 ملفات بحد أقصى",
            "Images or PDF — up to 8 files",
          )}
        </p>
        <Button className="mt-3" onClick={() => inputRef.current?.click()}>
          {tr("اختار الملفات", "Choose files")}
        </Button>
      </div>

      {files.length > 0 && (
        <>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {files.map((f, i) => (
              <li key={i} className="relative">
                {f.uri.startsWith("data:image/") ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={f.uri}
                    alt={f.name}
                    className="h-28 w-full rounded-lg border object-cover"
                  />
                ) : (
                  <span className="grid h-28 w-full place-items-center rounded-lg border bg-muted">
                    <FileText className="h-7 w-7 text-muted-foreground" />
                  </span>
                )}
                <button
                  onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                  className="absolute -end-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-destructive text-white"
                  aria-label={tr("شيل", "Remove")}
                >
                  <X className="h-3 w-3" />
                </button>
                <span className="absolute bottom-1 start-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  <ImageIcon className="me-1 inline h-3 w-3" />
                  {f.name.slice(0, 18)}
                </span>
              </li>
            ))}
          </ul>

          <Button onClick={() => void run()} disabled={busy} className="h-12 w-full text-base" data-tour="import-run">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />{" "}
                {tr("بيقرأ الجدول...", "Reading the timetable...")}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />{" "}
                {tr("اقرا الجدول", "Read the timetable")}
              </>
            )}
          </Button>
        </>
      )}

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {kept.length > 0 && (
        <div className="space-y-3" data-tour="import-review">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-bold">
              {tr("راجع قبل الحفظ", "Review before saving")}
            </h2>
            <span className="text-sm text-muted-foreground">
              {kept.length} {tr("محاضرة", "lectures")}
            </span>
            {existing.length > 0 && (
              <label className="ms-auto flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(e) => setReplace(e.target.checked)}
                />
                {tr(
                  "امسح الجدول الحالي الأول",
                  "Replace the current schedule",
                )}
              </label>
            )}
          </div>

          <ul className="space-y-2">
            {kept.map(({ row: d, i }) => (
              <li
                key={i}
                className="flex items-center gap-3 rounded-xl border bg-card p-3"
              >
                <span
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
                    duplicates.has(i)
                      ? "bg-amber-100 text-amber-700"
                      : "bg-emerald-100 text-emerald-700",
                  )}
                  title={
                    duplicates.has(i)
                      ? tr(
                          "موجودة بالفعل — هتتخطى وقت الحفظ",
                          "Already in the schedule — will be skipped on save",
                        )
                      : ""
                  }
                >
                  {duplicates.has(i) ? (
                    <X className="h-4 w-4" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <input
                    value={d.subject_name}
                    onChange={(e) => setPreview((p) => renameAt(p, i, e.target.value))}
                    className="w-full rounded-md border bg-transparent px-2 py-1 font-semibold"
                    dir="auto"
                  />
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {dayName(d.day, lang)} · {formatTime(d.start_time)} –{" "}
                    {formatTime(d.end_time)}
                    {d.hall && ` · ${d.hall}`}
                    {d.doctor && ` · ${d.doctor}`}
                    {d.code && ` · ${d.code}`}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 text-destructive"
                  onClick={() => drop(i)}
                  aria-label={tr("شيل السطر", "Remove row")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>

          {gone.length > 0 && (
            <div className="rounded-xl border border-dashed bg-muted/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">
                  {tr(
                    `${gone.length} محاضرة متشالة — لسه ترجع`,
                    `${gone.length} removed — still restorable`,
                  )}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ms-auto"
                  onClick={() => setPreview((p) => restoreAll(p))}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  {tr("استرجع الكل", "Restore all")}
                </Button>
              </div>
              <ul className="mt-2 space-y-1">
                {gone.map(({ row: d, i }) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {d.subject_name} · {dayName(d.day, lang)} ·{" "}
                      {formatTime(d.start_time)}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPreview((p) => restoreAt(p, i))}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      {tr("رجّعها", "Restore")}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end" data-tour="import-save">
            <Button
              variant="outline"
              onClick={() => setPreview(emptyPreview())}
              disabled={busy}
            >
              {tr("ألغي", "Discard")}
            </Button>
            <Button onClick={() => void commit()} disabled={busy} className="h-12 text-base">
              {tr("احفظ الجدول", "Save schedule")}
            </Button>
          </div>
        </div>
      )}

      <p className="text-center text-sm text-muted-foreground">
        {tr("محتاج تعدّل حاجة يدوي؟ ", "Need to tweak something by hand? ")}
        <Link href="/week" className="font-semibold text-primary underline">
          {tr("افتح الجدول", "Open the schedule")}
        </Link>
      </p>
    </div>
  );
}
