"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BookOpen, CheckCircle2, ListChecks, Sparkles, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/db/auth";
import { pageGuideFor, readPageSeen, markPageSeen } from "@/lib/page-guides";
import { readTourSeen, tourForPath } from "@/lib/tour";
import { Button } from "@/components/ui/button";
import type { Lang } from "@/lib/utils";

/** Dispatched by the header's help button to reopen the current page's guide. */
export const PAGE_GUIDE_EVENT = "jadoli:open-page-guide";

const pick = <T,>(pair: readonly [T, T], lang: Lang): T =>
  lang === "ar" ? pair[0] : pair[1];

/**
 * The education for one page: what it does and exactly what to do in it.
 *
 * Shown the first time a signed-in account lands on each page (keyed per
 * account, like the onboarding flag) and reopenable from the header whenever
 * the student forgets. It is a card, not a dialog: the student can ignore it
 * and keep reading the page behind it, because a guide that blocks nothing is
 * a guide that is allowed to be helpful.
 */
export function PageGuide() {
  const { tr, lang } = useI18n();
  const pathname = usePathname();
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const guide = pageGuideFor(pathname);
  const uid = session?.id;

  useEffect(() => {
    const g = pageGuideFor(pathname);
    const t = tourForPath(pathname);
    if (!g || !uid) {
      setOpen(false);
      return;
    }
    // A page with a tour is taught by the tour on its first visit; the static
    // card stays out of the way while the tour has not been seen yet.
    if (t && !readTourSeen(uid, t.key)) {
      setOpen(false);
      return;
    }
    if (readPageSeen(uid, g.key)) {
      setOpen(false);
      return;
    }
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, uid]);

  useEffect(() => {
    const reopen = () => setOpen(true);
    window.addEventListener(PAGE_GUIDE_EVENT, reopen);
    return () => window.removeEventListener(PAGE_GUIDE_EVENT, reopen);
  }, []);

  if (!open || !guide || !uid) return null;

  const dismiss = () => {
    markPageSeen(uid, guide.key);
    setOpen(false);
  };

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-primary/25 bg-card">
      <div className="flex items-start gap-3 border-b bg-primary/[0.04] p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <BookOpen className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold">
            {tr("دليل الصفحة", "Page guide")}
            <span className="text-muted-foreground"> — </span>
            {pick(guide.title, lang)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {tr(
              "مميزات الصفحة دي وإيه اللي يتحط فيها خطوة بخطوة.",
              "What this page does, and exactly what to do on it.",
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={tr("قفل", "Close")}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-5 p-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            {tr("مميزات الصفحة", "What's on this page")}
          </h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {guide.features.map((f, i) => (
              <li key={i} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{pick(f, lang)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <ListChecks className="h-4 w-4 text-primary" />
            {tr("اعمل كده بالظبط", "Do this, in order")}
          </h3>
          <ol className="space-y-2 text-sm text-muted-foreground">
            {guide.steps.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                  {i + 1}
                </span>
                <span>{pick(s, lang)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t bg-muted/30 p-3">
        <Button size="sm" onClick={dismiss}>
          {tr("فهمت، أغلق", "Got it, close")}
        </Button>
      </div>
    </section>
  );
}