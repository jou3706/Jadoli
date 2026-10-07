"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/db/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { markOnboardingSeen, readOnboardingSeen } from "@/lib/onboarding";

const STEPS: readonly { title: [string, string]; body: [string, string] }[] = [
  {
    title: ["المواد", "Subjects"],
    body: [
      "ضيف موادك في صفحة «المواد» وارفع ملفاتها (PDF، صور، شيتات، روابط) — كل اللي محتاجه للمذاكرة في مكان واحد.",
      "Add your courses on the Subjects page and attach their files (PDFs, photos, sheets, links) — everything you study lives in one place.",
    ],
  },
  {
    title: ["المراجعة", "Review"],
    body: [
      "حوّل أي ملف لكروت مراجعة، والنظام يرجّعها لك على فترات بنفسها حسب إجاباتك.",
      "Turn any material into flashcards, and the app spaces your review around your answers.",
    ],
  },
  {
    title: ["الاختبارات", "Quizzes"],
    body: [
      "اعمل امتحان تجريبي على المقرر من ملفات مادتك نفسها في ثواني.",
      "Build a practice exam for a course from its own materials in seconds.",
    ],
  },
  {
    title: ["المساعد", "Assistant"],
    body: [
      "اسأله عن جدولك ومواعيدك ودرجاتك وأي سؤال في المذاكرة — بيقرا بياناتك الحقيقية.",
      "Ask it about your timetable, deadlines, grades or anything you are studying — it reads your actual data.",
    ],
  },
];

/**
 * First-run guide, shown once per account.
 *
 * Mounted above the shell so every page inside the app carries it. The seen
 * mark is keyed by the signed-in account, so it appears exactly once for the
 * accounts that already exist and once for every account signed up later, and
 * never after it is dismissed.
 */
export function OnboardingGuide() {
  const { session, isLoading } = useAuth();
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const uid = session?.id ?? "";

  useEffect(() => {
    if (isLoading || !uid) return;
    if (!readOnboardingSeen(uid)) setOpen(true);
  }, [uid, isLoading]);

  const dismiss = () => {
    setOpen(false);
    if (uid) markOnboardingSeen(uid);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(o) : dismiss())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">
            {tr("أهلاً بيك في جادول", "Welcome to Jadwali")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {STEPS.map((s, idx) => (
            <div key={s.title[0]} className="flex gap-3">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {idx + 1}
              </div>
              <div>
                <div className="text-sm font-semibold">{tr(s.title[0], s.title[1])}</div>
                <div className="text-xs text-muted-foreground">{tr(s.body[0], s.body[1])}</div>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button className="w-full" onClick={dismiss}>
            {tr("فهمت، خلينا نبدأ", "Got it, let's start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}