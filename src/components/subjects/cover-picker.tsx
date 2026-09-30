"use client";

import { useEffect, useState } from "react";
import { ExternalLink, ImageOff, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { CoverCandidate } from "@/lib/cover-search";

/**
 * A small grid of Wikimedia Commons images for one course. The student picks —
 * a search engine's idea of "Data Structures" is often a book cover, and only
 * they know which picture suits the course.
 */
export function CoverPicker({
  open,
  onOpenChange,
  subject,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  subject: string;
  onPick: (c: CoverCandidate) => void;
}) {
  const { tr } = useI18n();
  const [images, setImages] = useState<CoverCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError("");

    fetch(`/api/cover/search?subject=${encodeURIComponent(subject)}`)
      .then(async (res) => {
        const data = (await res.json()) as { images?: CoverCandidate[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (alive) setImages(data.images ?? []);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [open, subject]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">
            {tr("اختار صورة", "Pick a cover")}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{subject}</p>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {tr("بجيب الصور…", "Finding images…")}
          </div>
        )}

        {!loading && error && (
          <p className="py-6 text-sm text-destructive">{error}</p>
        )}

        {!loading && !error && images.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">
            <ImageOff className="mx-auto mb-2 h-7 w-7 opacity-50" />
            <p className="text-sm">
              {tr(
                "مفيش صور مناسبة. جرّب تبحث باسم تاني أو استخدم الكوفر الافتراضي.",
                "No matching images. Try another name or keep the default cover.",
              )}
            </p>
          </div>
        )}

        {images.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((c) => (
              <li key={c.page || c.title}>
                <button
                  type="button"
                  onClick={() => onPick(c)}
                  className="group block w-full overflow-hidden rounded-xl border text-start transition-colors hover:border-primary"
                >
                  {/* Thumbnails come from Wikimedia, so a plain img is the
                      simplest correct way to show them. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.thumb}
                    alt={c.title}
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                  />
                  <span className="block p-2">
                    <span className="line-clamp-2 text-[11px] leading-tight">
                      {c.title.replace(/\.[a-z0-9]+$/i, "")}
                    </span>
                    <span className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                      {c.free ? (
                        <span className="text-emerald-600">{c.license}</span>
                      ) : (
                        <span className="truncate" title={`${c.artist} · ${c.license}`}>
                          {c.artist || c.license}
                        </span>
                      )}
                      {c.page && (
                        <ExternalLink
                          className="ms-auto h-3 w-3 shrink-0 opacity-60"
                          aria-hidden
                        />
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tr("إلغاء", "Cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
