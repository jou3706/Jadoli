"use client";

import { useState } from "react";
import { ImageIcon, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { canStoreFiles, removeStoredFile, safeFileName, saveCoverImage } from "@/lib/db/storage";
import { safeImageUrl, subjectCover } from "@/lib/subjects";
import { CoverPicker } from "@/components/subjects/cover-picker";
import { cn } from "@/lib/utils";
import type { CoverCandidate } from "@/lib/cover-search";
import type { Subject } from "@/lib/db/types";

/** Downscales whatever the model returned to a small square JPEG-ish PNG. */
async function square(dataUrl: string, size = 512): Promise<Blob> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();

  const side = Math.min(img.naturalWidth, img.naturalHeight) || size;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(
    img,
    (img.naturalWidth - side) / 2,
    (img.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.86));
  if (!blob) throw new Error("encode failed");
  return blob;
}

export function SubjectCoverTile({
  name,
  subject,
  onSave,
  onRemove,
}: {
  name: string;
  /** the subjects row for this course, or null when it was never created */
  subject: Subject | null;
  /** credit is the licence/author line required by the image licence */
  onSave: (url: string, credit?: string) => void;
  onRemove: () => void;
}) {
  const { tr } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const cover = subjectCover(name);
  const image = safeImageUrl(subject?.image_url);
  const canGenerate = canStoreFiles();

  async function generate() {
    setBusy(true);
    try {
      const res = await fetch("/api/ai/cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: name }),
      });
      const data = (await res.json()) as { image?: string; error?: string };
      if (!res.ok || !data.image) {
        // The free tier's image quota is tiny, so this is expected, not a bug.
        throw new Error(
          data.error === "IMAGE_QUOTA"
            ? tr(
                "رصيد صور الذكاء الاصطناعي خلص — جرّب بعدين.",
                "AI image quota is used up — try later.",
              )
            : (data.error ?? `HTTP ${res.status}`),
        );
      }

      const blob = await square(data.image);
      const saved = await saveCoverImage(blob, safeFileName(name));
      onSave(saved.url, "");
      toast({ title: tr("تجهّزت صورة المادة", "Cover ready") });
    } catch (e) {
      toast({
        title: tr("مقدرنا نعمل صورة", "Could not make a cover"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    const path = subject?.image_url;
    setBusy(true);
    try {
      // The path is not stored on the row, so the file is replaced by a new
      // cover rather than deleted; the old object is cleaned up by the bucket.
      onRemove();
      if (path) await removeStoredFile(storagePathOf(path));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "group/cover relative h-14 w-14 shrink-0 overflow-hidden rounded-xl",
      )}
      style={{ background: cover.background, boxShadow: `0 0 0 1px ${cover.ring}` }}
    >
      {image ? (
        // Cover is decorative and always user content, so plain <img> avoids
        // the next/image loader entirely.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span className="grid h-full w-full place-items-center text-2xl" aria-hidden>
          {cover.emoji}
        </span>
      )}

      {canGenerate && (
        <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/55 opacity-0 transition-opacity focus-within:opacity-100 group-hover/cover:opacity-100">
          <button
            type="button"
            onClick={() => setPicking(true)}
            title={tr("اختار صورة", "Pick an image")}
            aria-label={tr("اختار صورة", "Pick an image")}
            className="grid h-6 w-6 place-items-center rounded-full bg-white/90 text-black"
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy}
            title={tr("صورة بالذكاء الاصطناعي", "AI cover")}
            aria-label={tr("صورة بالذكاء الاصطناعي", "AI cover")}
            className="grid h-6 w-6 place-items-center rounded-full bg-white/90 text-black disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
          </button>
          {image && (
            <button
              type="button"
              onClick={() => void clear()}
              disabled={busy}
              title={tr("شيل الصورة", "Remove cover")}
              aria-label={tr("شيل الصورة", "Remove cover")}
              className="grid h-6 w-6 place-items-center rounded-full bg-white/90 text-black disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <CoverPicker
        open={picking}
        onOpenChange={setPicking}
        subject={name}
        onPick={async (picked) => {
          setBusy(true);
          try {
            const blob = await square(picked.thumb);
            const saved = await saveCoverImage(blob, safeFileName(name));
            onSave(saved.url, creditOf(picked));
            toast({ title: tr("تحطت الصورة", "Cover set") });
          } catch (e) {
            toast({
              title: tr("مقدرناش نجيب الصورة", "Could not use that image"),
              description: e instanceof Error ? e.message : undefined,
              variant: "destructive",
            });
          } finally {
            setBusy(false);
            setPicking(false);
          }
        }}
      />
    </div>
  );
}

/** Attribution is required by most CC licences, so it travels with the image. */
function creditOf(c: CoverCandidate): string {
  if (c.free) return c.license;
  return [c.artist, c.license].filter(Boolean).join(" · ");
}

/** The public URL ends with the object path, so recover it for deletion. */
function storagePathOf(publicUrl: string): string {
  const m = /\/storage\/v1\/object\/public\/materials\/(.+)$/i.exec(publicUrl);
  return m ? decodeURIComponent(m[1]) : "";
}
