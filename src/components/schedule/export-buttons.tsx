"use client";

import { useRef, useState } from "react";
import { Copy, FileText, Image as ImageIcon, Loader2, Share2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import {
  downloadCanvasPdf,
  downloadCanvasPng,
  nodeToCanvas,
} from "@/lib/export";

export function ExportButtons({
  targetRef,
  fileName = "جدولي-الأسبوع",
}: {
  targetRef: React.RefObject<HTMLElement | null>;
  fileName?: string;
}) {
  const { tr } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState<"" | "img" | "pdf" | "share">("");

  const capture = async () => {
    const node = targetRef.current;
    if (!node) return null;
    return nodeToCanvas(node);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={Boolean(busy)}
        onClick={async () => {
          setBusy("img");
          try {
            const canvas = await capture();
            if (!canvas) return;
            downloadCanvasPng(canvas, `${fileName}.png`);
            toast({ title: tr("تم حفظ الصورة", "Image saved") });
          } catch {
            toast({
              title: tr("تعذّر التصدير", "Export failed"),
              variant: "destructive",
            });
          } finally {
            setBusy("");
          }
        }}
      >
        <ImageIcon className="h-4 w-4" />{" "}
        {busy === "img" ? "..." : tr("صورة", "Image")}
      </Button>

      <Button
        variant="outline"
        size="sm"
        disabled={Boolean(busy)}
        onClick={async () => {
          setBusy("pdf");
          try {
            const canvas = await capture();
            if (!canvas) return;
            await downloadCanvasPdf(canvas, `${fileName}.pdf`);
            toast({ title: tr("تم حفظ الـ PDF", "PDF saved") });
          } catch {
            toast({
              title: tr("تعذّر التصدير", "Export failed"),
              variant: "destructive",
            });
          } finally {
            setBusy("");
          }
        }}
      >
        <FileText className="h-4 w-4" />{" "}
        {busy === "pdf" ? "..." : "PDF"}
      </Button>

      <Button
        variant="outline"
        size="sm"
        disabled={Boolean(busy)}
        onClick={async () => {
          setBusy("share");
          try {
            const canvas = await capture();
            if (!canvas) return;
            const blob = await new Promise<Blob | null>((res) =>
              canvas.toBlob(res, "image/png"),
            );
            if (!blob) return;
            const file = new File([blob], `${fileName}.png`, {
              type: "image/png",
            });
            if (navigator.canShare?.({ files: [file] })) {
              await navigator.share({
                files: [file],
                title: tr("جدولي الدراسي", "My Schedule"),
              });
            } else {
              downloadCanvasPng(canvas, `${fileName}.png`);
              toast({
                title: tr(
                  "المشاركة غير مدعومة — تم تنزيل الصورة",
                  "Sharing not supported — image downloaded",
                ),
              });
            }
          } catch {
            toast({
              title: tr("تعذّر المشاركة", "Share failed"),
              variant: "destructive",
            });
          } finally {
            setBusy("");
          }
        }}
      >
        <Share2 className="h-4 w-4" />{" "}
        {busy === "share" ? "..." : tr("مشاركة", "Share")}
      </Button>
    </div>
  );
}

export function ShareDialog({
  lectures,
  events,
}: {
  lectures: import("@/lib/db/types").Lecture[];
  events: import("@/lib/db/types").UniversityEvent[];
}) {
  const { tr } = useI18n();
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const copied = useRef(false);

  const create = async () => {
    // The server rejects an empty share, so say why instead of showing a
    // generic failure.
    if (!lectures.length) {
      toast({
        title: tr(
          "مفيش محاضرات تشارك. ضيف محاضرة الأول.",
          "There is nothing to share yet. Add a lecture first.",
        ),
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lectures, events }),
      });
      if (!res.ok) throw new Error("failed");
      const { token } = (await res.json()) as { token: string };
      setUrl(`${window.location.origin}/s/${token}`);
    } catch {
      toast({
        title: tr("تعذّر إنشاء رابط المشاركة", "Could not create the link"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (copied.current) {
      await navigator.clipboard.writeText(url);
      toast({ title: tr("اتنسخ", "Copied") });
      return;
    }
    copied.current = true;
    setUrl(url);
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: tr("اتنسخ", "Copied") });
    } catch {
      toast({
        title: tr("ما قدرناش ننسخ — انسخ يدوي", "Copy failed — select manually"),
      });
    }
  };

  return (
    <div className="space-y-3">
      {url ? (
        <>
          <div className="flex gap-2">
            <input
              readOnly
              value={url}
              dir="ltr"
              aria-label={tr("رابط المشاركة", "Share link")}
              className="h-10 flex-1 rounded-md border bg-background px-3 text-sm"
            />
            <Button size="icon" onClick={copy} aria-label={tr("نسخ", "Copy")}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
            >
              {tr("افتح الرابط", "Open link")}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                if (navigator.share) {
                  navigator
                    .share({ title: tr("جدولي الدراسي", "My schedule"), url })
                    .catch(() => {});
                } else {
                  void copy();
                }
              }}
            >
              {tr("شارك", "Share")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {tr(
              "هتعمل رابط عام لجدولك (من غير بيانات شخصية) يقدر أي حد يفتحه ويشوف المحاضرات.",
              "This creates a public link to your schedule (no personal data) that anyone can open to view the lectures.",
            )}
          </p>
          <Button
            className="w-full"
            disabled={busy}
            onClick={create}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />{" "}
                {tr("بيتعمل...", "Creating...")}
              </>
            ) : (
              <>
                <Share2 className="h-4 w-4" />{" "}
                {tr("اعمل رابط المشاركة", "Create share link")}
              </>
            )}
          </Button>
        </>
      )}
    </div>
  );
}
