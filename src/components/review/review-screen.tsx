"use client";

import { useMemo, useState } from "react";
import { BookOpen, CalendarClock, Play, Sparkles, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList, useMutate } from "@/lib/db/store";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge, Card, Skeleton } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, isoDate, nowCairo } from "@/lib/utils";
import { shortDate } from "@/lib/subject-events";
import { CARDS_PER_SESSION } from "@/lib/gaps";
import { NO_SUBJECT } from "@/lib/review-plan";
import {
  MATURE_INTERVAL_DAYS,
  isDue,
  reviewQueue,
  summarise,
  type SrsCard,
} from "@/lib/srs";
import type { ReviewSession } from "@/lib/db/types";
import { PlanPanel } from "@/components/review/plan-panel";
import { Reviewer } from "@/components/review/reviewer";
import { GenerateCardsDialog } from "@/components/review/generate-cards-dialog";

/**
 * The review page: what is due, what to do now, and when the next sitting is.
 *
 * Ordered by when it is needed rather than by what it is. The due cards are
 * first and are the reason the page exists; the summary is there to show a
 * student with nothing due today that the work is going somewhere, because a
 * queue of zero and a queue that has not been touched look exactly the same from
 * the outside. The planner and the sessions come last: they are about next week,
 * and they are the part that can wait until today is dealt with.
 *
 * A flashcard is only asked when it is due. Never ahead, because a card seen
 * early is a card whose interval has not earned its keep, and a queue that asks
 * for things it does not need yet is a queue that gets abandoned.
 */
export function ReviewScreen() {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data: cards = [], isLoading } = useList("Flashcard", "-due_date", 500);
  const { data: sessions = [] } = useList("ReviewSession", "date", 200);
  const { data: lectures = [] } = useList("Lecture", "-created_date", 300);
  const { remove } = useMutate("ReviewSession");

  // Cairo's date, not the device's, for the same reason the rest of the app
  // asks `nowCairo()`: a phone set to another zone still lives this week.
  const today = useMemo(() => isoDate(nowCairo()), []);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [sitting, setSitting] = useState<{ title: string; cards: SrsCard[] } | null>(null);

  const stats = useMemo(
    () => summarise(cards as SrsCard[], today),
    [cards, today],
  );

  const queue = useMemo(
    () => reviewQueue(cards as SrsCard[], today, CARDS_PER_SESSION),
    [cards, today],
  );

  const upcoming = useMemo(
    () =>
      sessions
        .filter((s) => !s.done && s.date >= today)
        .sort((a, b) =>
          a.date === b.date
            ? a.start_time.localeCompare(b.start_time)
            : a.date.localeCompare(b.date),
        ),
    [sessions, today],
  );

  /** The cards one session should work through, in the order it will ask them. */
  const cardsFor = (session: ReviewSession) =>
    reviewQueue(
      (cards as SrsCard[]).filter(
        (c) => (c.subject_key || "") === (session.subject_key || "") && isDue(c, today),
      ),
      today,
      session.card_count || CARDS_PER_SESSION,
    );

  const deleteSession = async (session: ReviewSession) => {
    try {
      await remove(session.id);
    } catch (e) {
      toast({
        title: tr("مش قادرين نشيل الجلسة", "Could not remove that session"),
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  if (isLoading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[32px] font-bold text-foreground">
            {tr("المراجعة", "Review")}
          </h1>
          <p className="text-base text-muted-foreground">
            {tr(
              "الكروت اللي اتعملت من ملاحظاتك، وتراجعها لما تحب",
              "Cards made from your notes, to work through whenever you like",
            )}
          </p>
        </div>
        <Button onClick={() => setGenerateOpen(true)} className="h-12 gap-2 px-5 text-base">
          <Sparkles className="h-4 w-4" /> {tr("كروت جديدة", "New cards")}
        </Button>
      </div>

      {cards.length === 0 ? (
        <EmptyState onGenerate={() => setGenerateOpen(true)} />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={tr("مستنية دلوقتي", "Due now")} value={stats.due} tone="due" />
            <Stat label={tr("جديدة", "New")} value={stats.fresh} />
            <Stat label={tr("لسه", "Learning")} value={stats.young} />
            <Stat
              label={tr("مرسّخة", "Known")}
              value={stats.mature}
              hint={tr(`أكثر من ${MATURE_INTERVAL_DAYS} يوم`, `over ${MATURE_INTERVAL_DAYS} days`)}
            />
          </section>

          {queue.length > 0 && (
            <section className="rounded-2xl border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-heading font-bold">
                    {stats.due === 1
                      ? tr("كارت واحد مستنيك", "One card is waiting")
                      : tr(`${stats.due} كارت مستنيك`, `${stats.due} cards are waiting`)}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {tr(
                      "مفيش استعجال، وارجع وقت ما تحب",
                      "No rush, and come back whenever you like",
                    )}
                  </p>
                </div>
                <Button
                  className="gap-2"
                  onClick={() =>
                    setSitting({
                      title: tr("اللي مستنيك", "What is waiting"),
                      cards: queue,
                    })
                  }
                >
                  <Play className="h-4 w-4" /> {tr("ابدأ", "Start")}
                </Button>
              </div>

              {stats.bySubject.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {stats.bySubject
                    .filter((s) => s.due > 0)
                    .map((s) => (
                      <li key={s.subject_key || NO_SUBJECT}>
                        <button
                          type="button"
                          onClick={() => {
                            const subject = s.subject_key;
                            const picked = reviewQueue(
                              (cards as SrsCard[]).filter(
                                (c) => (c.subject_key || "") === subject && isDue(c, today),
                              ),
                              today,
                              CARDS_PER_SESSION,
                            );
                            setSitting({
                              title: subject || tr("كل المواد", "All courses"),
                              cards: picked,
                            });
                          }}
                          className="rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted"
                        >
                          {s.subject_key || tr("كل المواد", "All courses")}
                          <span className="ms-1.5 tabular-nums text-muted-foreground">
                            {s.due}
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </section>
          )}

          <PlanPanel cards={cards} lectures={lectures} sessions={sessions} today={today} />

          {upcoming.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 font-heading font-bold">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                {tr("الجلسات الجاية", "Upcoming sittings")}
              </h2>
              <ul className="space-y-2">
                {upcoming.map((s) => {
                  const picked = cardsFor(s);
                  return (
                    <SessionRow
                      key={s.id}
                      session={s}
                      today={today}
                      lang={lang}
                      dueCount={picked.length}
                      onStart={() =>
                        setSitting({
                          title: s.subject_key || tr("كل المواد", "All courses"),
                          cards: picked,
                        })
                      }
                      onDelete={() => deleteSession(s)}
                    />
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      <GenerateCardsDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        subject=""
        today={today}
      />

      <Dialog open={Boolean(sitting)} onOpenChange={(open) => !open && setSitting(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">{sitting?.title}</DialogTitle>
            <DialogDescription>
              {tr(
                "جاوب بصراحة، عشان الكارت يرجع لك في وقته",
                "Answer honestly, so each card comes back when it should",
              )}
            </DialogDescription>
          </DialogHeader>
          {sitting && (
            <Reviewer
              key={sitting.title}
              cards={sitting.cards}
              today={today}
              onFinished={() => setSitting(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "due";
}) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "font-display text-2xl font-bold tabular-nums",
          tone === "due" && value > 0 && "text-primary",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function SessionRow({
  session,
  today,
  lang,
  dueCount,
  onStart,
  onDelete,
}: {
  session: ReviewSession;
  today: string;
  lang: "ar" | "en";
  dueCount: number;
  onStart: () => void;
  onDelete: () => void;
}) {
  const { tr } = useI18n();
  const overdue = session.date < today;

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3">
      <Badge className="tabular-nums">
        {session.date === today ? tr("النهارده", "today") : shortDate(session.date, lang)}
      </Badge>
      <span className="font-bold tabular-nums">
        {session.start_time} — {session.end_time}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {session.subject_key || tr("كل المواد", "All courses")}
      </span>
      <span className="text-xs text-muted-foreground">
        {lang === "en"
          ? `${dueCount} of ${session.card_count} due`
          : `${dueCount} من ${session.card_count} مستني`}
      </span>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={onStart}>
        <BookOpen className="h-3.5 w-3.5" /> {tr("ابدأ", "Start")}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 text-destructive"
        aria-label={tr("شيل الجلسة", "Remove session")}
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      {overdue && (
        <span className="w-full text-[11px] text-destructive">
          {tr("الجلسة دي فات وقتها", "This one is past its day")}
        </span>
      )}
    </li>
  );
}

function EmptyState({ onGenerate }: { onGenerate: () => void }) {
  const { tr } = useI18n();
  return (
    <div className="rounded-2xl border border-dashed p-8 text-center">
      <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
      <p className="mt-3 font-heading text-lg font-bold">
        {tr("لسه مفيش كروت", "No cards yet")}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        {tr(
          "الصق ملخص أي محاضرة، وأنا أعملهولك كروت تراجعها",
          "Paste any lecture summary and I will turn it into cards to review",
        )}
      </p>
      <Button onClick={onGenerate} className="mt-4 gap-2">
        <Sparkles className="h-4 w-4" /> {tr("اعمل أول كروت", "Make the first cards")}
      </Button>
    </div>
  );
}