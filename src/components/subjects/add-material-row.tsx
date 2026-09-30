"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, FileUp, Link2, Loader2, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { safeUrl } from "@/lib/materials";
import {
  ACCEPTED,
  MAX_FILE_BYTES,
  canStoreFiles,
  formatBytes,
  saveMaterialFile,
} from "@/lib/db/storage";
import { cn } from "@/lib/utils";
import type { Material } from "@/lib/db/types";

/** A URL dropped from another tab/browser, rather than a file from the OS. */
function droppedUrl(e: React.DragEvent): string {
  const text = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
  return safeUrl(text.split("\n")[0]);
}

/**
 * The row at the bottom of the materials list.
 *
 * Adding a file is slow on a phone and most of the time the file is already
 * somewhere in the account, so the list of what the user already has comes
 * first. Uploading stays available under "add a new one" for the rest.
 */
export function AddMaterialRow({
  subjectKey,
  available = [],
  onReuse,
  onAdd,
  onAddLink,
}: {
  subjectKey: string;
  /**
   * Materials the user owns that are not listed for this subject yet. Left out
   * on the subject card, where the list above already shows this subject's own
   * materials and the row is only a drop target.
   */
  available?: Material[];
  /** Copies an existing material into this subject. */
  onReuse?: (m: Material) => void;
  onAdd: (f: { path: string; url: string; title: string; size: number }) => void;
  onAddLink: (url: string) => void;
}) {
  const { tr } = useI18n();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const files = canStoreFiles();

  async function take(list: FileList | File[]) {
    const file = list[0];
    if (!file) return;
    if (!files) {
      toast({
        title: tr("الرفع محتاج Supabase", "Uploading needs Supabase"),
        description: tr(
          "ارفع الملف من Supabase، أو الصق لينك بدل الملف.",
          "Upload the file to Supabase, or paste a link instead.",
        ),
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast({
        title: tr("الملف كبير", "File is too large"),
        description: `${formatBytes(file.size)} / ${formatBytes(MAX_FILE_BYTES)}`,
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const saved = await saveMaterialFile(file);
      onAdd({
        path: saved.path,
        url: saved.url,
        title: file.name,
        size: file.size,
      });
      toast({ title: tr("اتضافت المادة", "Material added") });
    } catch (e) {
      toast({
        title: tr("فشل الرفع", "Upload failed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <div className="border-t">
      {available.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`${tr("مواد عندك", "Your materials")} — ${subjectKey}`}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-muted/50"
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-current">
              <Plus className="h-3.5 w-3.5" />
            </span>
            <span className="truncate font-medium">
              {tr("اختار من موادك", "Pick from your materials")}
              <span className="ms-1.5 font-normal text-muted-foreground">
                ({available.length})
              </span>
            </span>
            <Chevron className="ms-auto h-4 w-4 shrink-0 text-muted-foreground" />
          </button>

          {open && (
            <ul className="max-h-64 divide-y overflow-y-auto border-t bg-muted/30">
              {available.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onReuse?.(m);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-start text-sm transition-colors hover:bg-accent"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{m.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {m.subject_key}
                        {m.size > 0 && ` · ${formatBytes(m.size)}`}
                      </span>
                    </span>
                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {/* The upload path, for the materials that are not in the account yet. */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`${tr("إضافة مادة جديدة", "Add a new material")} — ${subjectKey}`}
        onClick={() => {
          if (files) inputRef.current?.click();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (files) inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const url = droppedUrl(e);
          // A link dragged from the browser wins over nothing; a file wins over text.
          if (e.dataTransfer.files.length) void take(e.dataTransfer.files);
          else if (url) onAddLink(url);
        }}
        className={cn(
          "flex cursor-pointer items-center gap-2 border-t border-dashed px-3 py-2.5 text-sm transition-colors",
          over
            ? "border-primary bg-primary/10"
            : "border-muted-foreground/30 text-muted-foreground hover:bg-muted/50",
        )}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <span
            className={cn(
              "grid h-6 w-6 shrink-0 place-items-center rounded-full border",
              over ? "border-primary text-primary" : "border-current",
            )}
          >
            <Plus className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="truncate font-medium">
          {busy
            ? tr("بيرفع…", "Uploading…")
            : over
              ? tr("أفلت الملف هنا", "Drop it here")
              : tr("إضافة مادة جديدة", "Add a new material")}
        </span>
        <span className="ms-auto hidden shrink-0 items-center gap-1 text-[11px] sm:flex">
          {files ? (
            <>
              <FileUp className="h-3 w-3" /> {tr("اسحب الملف هنا", "drop a file")}
            </>
          ) : (
            <>
              <Link2 className="h-3 w-3" /> {tr("لينك بس", "links only")}
            </>
          )}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void take(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
