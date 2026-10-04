"use client";

import { useEffect, useState } from "react";
import { BookOpen, Loader2, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { authHeader } from "@/lib/db/supabase-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import {
  readCachedSummary,
  writeCachedSummary,
  type MaterialSummary,
} from "@/lib/ai/summary";
import type { Material } from "@/lib/db/types";

/**
 * The file, read back as a page you can revise from.
 *
 * Shown from the cache when it is there, because the file behind it has not
 * changed; the refresh button is there for the case where the summary was
 * written badly, which is a real thing when a lecture PDF is thirty scanned
 * pages and the useful part is on nine of them.
 */
export function SummaryDialog({
  open,
  onOpenChange,
  material,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  material: Material | null;
}) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<MaterialSummary | null>(null);
  const [err, setErr] = useState("");

  const read = async (m: Material, force: boolean) => {
    if (!force) {
      const cached = readCachedSummary(m.id);
      if (cached) {
        setData(cached);
        return;
      }
    }
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/ai/summary", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ materialId: m.id, language: lang === "en" ? "en" : "ar" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || body.reason || body.error || "read failed");
      const next: MaterialSummary = {
        summary: body.summary ?? "",
        keyPoints: body.keyPoints ?? [],
        glossary: body.glossary ?? [],
      };
      writeCachedSummary(m.id, next);
      setData(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open || !material) return;
    setData(null);
    setErr("");
    void read(material, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, material?.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">
            <span className="inline-flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              {material?.title || tr("ملخص المادة", "Material summary")}
            </span>
          </DialogTitle>
        </DialogHeader>

        {busy ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {tr("بقرأ الملف…", "Reading the file…")}
          </div>
        ) : err ? (
          <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            <p>{err}</p>
            {material && (
              <Button size="sm" variant="outline" onClick={() => void read(material, true)}>
                <RefreshCw className="h-3.5 w-3.5" /> {tr("جرّب تاني", "Try again")}
              </Button>
            )}
          </div>
        ) : !data ? null : (
          <div className="space-y-5">
            {data.summary && (
              <section className="space-y-2">
                <p className="text-sm font-semibold">{tr("الملخص", "Summary")}</p>
                {data.summary.split(/\n{2,}/).map((para, i) => (
                  <p key={i} className="text-sm leading-relaxed text-foreground/90">
                    {para}
                  </p>
                ))}
              </section>
            )}

            {data.keyPoints.length > 0 && (
              <section className="space-y-2">
                <p className="text-sm font-semibold">
                  {tr("أهم النقاط", "What has to be remembered")}
                </p>
                <ul className="space-y-1.5">
                  {data.keyPoints.map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data.glossary.length > 0 && (
              <section className="space-y-2">
                <p className="text-sm font-semibold">{tr("مصطلحات لازم تعرفها", "Vocabulary")}</p>
                <dl className="divide-y rounded-xl border">
                  {data.glossary.map((g, i) => (
                    <div key={i} className="p-3">
                      <dt className="text-sm font-semibold" dir="auto">
                        {g.term}
                      </dt>
                      <dd className="mt-0.5 text-sm text-muted-foreground" dir="auto">
                        {g.meaning}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {!data.summary && !data.keyPoints.length && !data.glossary.length && (
              <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                {tr("الملف ده مفيهوش نص يُلخّص.", "There was nothing readable in that file.")}
              </p>
            )}

            {material && (
              <div className="flex justify-end border-t pt-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    toast({ title: tr("بنلخّص من جديد", "Reading it again") });
                    void read(material, true);
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> {tr("لخّص من جديد", "Summarise again")}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}