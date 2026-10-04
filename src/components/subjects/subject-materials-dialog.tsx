"use client";

import { useMemo, useState } from "react";
import {
  CalendarPlus,
  Copy,
  ExternalLink,
  FileText,
  ImageIcon,
  Link2,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useMutate } from "@/lib/db/store";
import { useToast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { detectKind, kindMeta, pickerMaterials, safeUrl, sharedFileCounts, type MaterialKindId } from "@/lib/materials";
import { SyllabusDialog } from "@/components/subjects/syllabus-dialog";
import { formatBytes, removeStoredFile } from "@/lib/db/storage";
import { AddMaterialRow } from "@/components/subjects/add-material-row";
import { cn } from "@/lib/utils";
import type { Material } from "@/lib/db/types";

const KIND_ICONS = {
  pdf: FileText,
  slides: FileText,
  doc: FileText,
  image: ImageIcon,
  video: Play,
  link: Link2,
} as const;

/** One file or link, with rename / copy / open / delete. */
export function MaterialRow({
  material,
  /** True when another row still points at the same file, so it must survive. */
  fileShared,
}: {
  material: Material;
  fileShared?: boolean;
}) {
  const { tr } = useI18n();
  const toast = useToast();
  const { update, remove } = useMutate("Material");
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(material.title);
  const [busy, setBusy] = useState(false);
  const [dates, setDates] = useState(false);

  const kindId: MaterialKindId = detectKind(material.url, material.type);
  const kind = kindMeta(kindId);
  const KindIcon = KIND_ICONS[kindId];
  const href = safeUrl(material.url);

  async function del() {
    setBusy(true);
    try {
      await remove(material.id);
      // The row is gone, so a failed cleanup only leaves an orphan file.
      // Doing it in this order never leaves a row pointing at a missing file.
      // A copy made for another subject points here too, so the file has to
      // stay put or that copy would be left holding a dead link.
      if (material.file_path && !fileShared) {
        await removeStoredFile(material.file_path).catch(() => {});
      }
      toast({ title: tr("اتحذفت المادة", "Material deleted") });
    } catch (e) {
      toast({
        title: tr("مقدرناش نحذف", "Could not delete"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center gap-3 px-3 py-2.5 text-sm">
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", kind.tone)}>
        <KindIcon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        {renaming ? (
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8"
            autoFocus
            onBlur={() => {
              const next = title.trim();
              if (next && next !== material.title) void update(material.id, { title: next });
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setTitle(material.title);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <p className="truncate font-semibold">{material.title}</p>
        )}
        <p className="truncate text-xs text-muted-foreground" dir="ltr">
          {href || material.url}
          {material.size > 0 && ` · ${formatBytes(material.size)}`}
        </p>
      </div>

      <div className="flex shrink-0 gap-0.5">
        {/* Only a file this app holds can be read: the route fetches it through
            the student's own storage, and a link has no file behind it. */}
        {material.file_path && kindId !== "video" && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label={tr("استخرج المواعيد", "Extract dates")}
            title={tr("استخرج مواعيد الامتحانات من الملف", "Pull exam dates out of this file")}
            onClick={() => setDates(true)}
          >
            <CalendarPlus className="h-3.5 w-3.5" />
          </Button>
        )}
        {href && (
          <>
<Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label={tr("انسخ", "Copy")}
          onClick={() =>
                void navigator.clipboard
                  .writeText(href)
                  .then(() => toast({ title: tr("اتنسخ", "Copied") }))
                  .catch(() =>
                    toast({ title: tr("مقدرتش أنسخ", "Copy failed"), variant: "destructive" }),
                  )
              }
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={tr("افتح", "Open")}
              onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label={tr("إعادة تسمية", "Rename")}
          onClick={() => {
            setTitle(material.title);
            setRenaming(true);
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-destructive"
          disabled={busy}
          aria-label={tr("احذف المادة", "Delete material")}
          onClick={() => void del()}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {/* Mounted only once it is opened: a dialog per row would otherwise be a
          hidden dialog for every file on every course. */}
      {dates && (
        <SyllabusDialog open={dates} onOpenChange={setDates} material={material} />
      )}
    </li>
  );
}

/**
 * The subject's materials, opened by clicking the subject. Dropping a file
 * works here as well as on the card, so both routes stay available.
 */
export function SubjectMaterialsDialog({
  open,
  onOpenChange,
  name,
  materials,
  allMaterials,
  onReuse,
  onAdd,
  onAddLink,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  materials: Material[];
  /** Every material in the account, so one can be reused from another subject. */
  allMaterials: Material[];
  onReuse: (m: Material) => void;
  onAdd: (f: { path: string; url: string; title: string; size: number }) => void;
  onAddLink: (url: string) => void;
}) {
  const { tr } = useI18n();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  /**
   * Anything the account already holds that is not in this list yet. A reuse
   * makes a second row share the file, so the delete below checks the counts.
   */
  /**
   * Every material in the account, flagged with the ones this subject already
   * shows. Keeping them in the list is what makes the row visible at all when
   * the account holds a single subject.
   */
  const available = useMemo(
    () => pickerMaterials(allMaterials, materials),
    [allMaterials, materials],
  );
  const sharedFiles = useMemo(() => sharedFileCounts(allMaterials), [allMaterials]);

  function submitLink() {
    const clean = safeUrl(url);
    if (!clean) {
      setError(
        tr(
          "اللينك لازم يبدأ بـ http:// أو https://",
          "The link must start with http:// or https://",
        ),
      );
      return;
    }
    onAddLink(clean);
    setUrl("");
    setError("");
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[88vh] overflow-hidden p-0">
          <DialogHeader className="border-b p-4 pb-3">
            <DialogTitle className="font-heading text-2xl">{name}</DialogTitle>
            <p className="text-sm text-muted-foreground">
              {materials.length} {tr("مادة دراسية", "materials")}
            </p>
          </DialogHeader>

          <div className="max-h-[62vh] overflow-y-auto">
            {materials.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {tr(
                  "لسه مفيش مواد في هذه المادة. اسحب ملف أو الصق لينك.",
                  "No materials yet — drop a file or paste a link.",
                )}
              </p>
            ) : (
              <ul className="divide-y">
                {materials.map((m) => (
                  <MaterialRow
                    key={m.id}
                    material={m}
                    fileShared={
                      !!m.file_path && (sharedFiles.get(m.file_path) ?? 0) > 1
                    }
                  />
                ))}
              </ul>
            )}

            <AddMaterialRow
              subjectKey={name}
              available={available}
              onReuse={onReuse}
              onAdd={onAdd}
              onAddLink={onAddLink}
            />

            {/* phones have no drag and drop, so the link goes in by hand */}
            <form
              className="flex items-start gap-2 border-t p-3"
              onSubmit={(e) => {
                e.preventDefault();
                submitLink();
              }}
            >
              <div className="min-w-0 flex-1">
                <Input
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setError("");
                  }}
                  dir="ltr"
                  inputMode="url"
                  placeholder="https://"
                  aria-label={tr("اللينك", "Link")}
                  className="h-9"
                />
                {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
              </div>
              <Button type="submit" size="sm" className="h-9 shrink-0">
                {tr("ضيف", "Add")}
              </Button>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
