"use client";

import { useMemo, useState } from "react";
import { CalendarCheck, Loader2, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useMutate } from "@/lib/db/store";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { shortDate } from "@/lib/subject-events";
import {
  NO_SUBJECT,
  busyByWeekday,
  planReviewSessions,
  proposalToRow,
  proposalTotals,
  type SessionProposal,
} from "@/lib/review-plan";
import type { Flashcard, Lecture, ReviewSession } from "@/lib/db/types";

/**
 * Suggestions, and the button that agrees to them.
 *
 * The planner is only ever asked what it *would* do. Nothing here writes before
 * the last button, and the day and time of every proposal are shown rather than
 * summarised as "this week", because the whole value of a proposal is that it is
 * a specific free half-hour and not a vague promise to review more.
 *
 * Refuses to save anything when there is nothing due: an empty plan offered as
 * a button is a button that teaches students to ignore it.
 */
export function PlanPanel({
  cards,
  lectures,
  sessions,
  today,
  onPlanned,
}: {
  cards: Flashcard[];
  lectures: Lecture[];
  sessions: ReviewSession[];
  today: string;
  onPlanned?: (count: number) => void;
}) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { bulkCreate } = useMutate("ReviewSession");
  const [busy, setBusy] = useState(false);
  const [dropped, setDropped] = useState<number[]>([]);

  const proposals = useMemo(
    () =>
      planReviewSessions({
        today,
        cards,
        lecturesByDay: busyByWeekday(lectures),
        booked: sessions
          .filter((s) => !s.done)
          .map((s) => ({
            date: s.date,
            day: new Date(`${s.date}T00:00:00Z`).getUTCDay(),
            start_time: s.start_time,
            end_time: s.end_time,
          })),
      }),
    [cards, lectures, sessions, today],
  );

  const totals = useMemo(() => proposalTotals(proposals), [proposals]);
  const kept = proposals.filter((_, i) => !dropped.includes(i));

  const accept = async () => {
    if (!kept.length) return;
    setBusy(true);
    try {
      await bulkCreate(kept.map(proposalToRow));
      onPlanned?.(kept.length);
      setDropped([]);
      toast({
        title: tr(
          `اتحجزت ${kept.length} جلسة`,
          `${kept.length} sessions booked`,
        ),
        description: tr(
          "لقايتهم في الصفحة دي، وفي الأسبوع كله",
          "They are on this page and on the full week",
        ),
      });
    } catch (e) {
      toast({
        title: tr("مش قادرين نحجز", "Could not book those"),
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  if (!proposals.length) return null;

  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading font-bold">
            {tr("فراغات الأسبوع", "Holes in your week")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {lang === "en"
              ? `${totals.sessions} sittings · ${Math.round(totals.minutes / 5) * 5} min · ${totals.cards} cards over ${totals.days} days`
              : `${totals.sessions} جلسة · ${Math.round(totals.minutes / 5) * 5} دقيقة · ${totals.cards} كارت على ${totals.days} يوم`}
          </p>
        </div>
        <Button onClick={accept} disabled={busy || !kept.length} className="gap-2">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CalendarCheck className="h-4 w-4" />
          )}
          {kept.length
            ? tr(`احجز ${kept.length}`, `Book ${kept.length}`)
            : tr("مفيش", "None left")}
        </Button>
      </div>

      <ul className="mt-3 space-y-2">
        {proposals.map((p, i) => (
          <ProposalRow
            key={`${p.date}-${p.start_time}-${p.subject_key}`}
            proposal={p}
            today={today}
            lang={lang}
            dropped={dropped.includes(i)}
            onToggle={() =>
              setDropped((prev) =>
                prev.includes(i) ? prev.filter((n) => n !== i) : [...prev, i],
              )
            }
          />
        ))}
      </ul>

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        {tr(
          "دي اقتراحات، مش تعديل على جدولك. سيبتها زي ما هي لو مش عايزها.",
          "These are suggestions, not changes. Leave them if you do not want them.",
        )}
      </p>
    </section>
  );
}

function ProposalRow({
  proposal,
  today,
  lang,
  dropped,
  onToggle,
}: {
  proposal: SessionProposal;
  today: string;
  lang: "ar" | "en";
  dropped: boolean;
  onToggle: () => void;
}) {
  const { tr } = useI18n();
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3 text-sm",
        dropped && "opacity-50",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={!dropped}
        className={cn(
          "h-5 w-5 shrink-0 rounded-md border",
          dropped ? "bg-muted" : "border-primary bg-primary",
        )}
      />
      <div className="min-w-0 flex-1">
        <span className="font-bold tabular-nums">
          {proposal.start_time} — {proposal.end_time}
        </span>
        <span className="ms-2 text-muted-foreground">
          {proposal.date === today
            ? tr("النهارده", "today")
            : shortDate(proposal.date, lang)}
        </span>
      </div>
      <div className="shrink-0 text-xs text-muted-foreground">
        {proposal.subject_key === NO_SUBJECT
          ? tr("الكل", "Everything")
          : proposal.subject_key}
        {" · "}
        {tr(`${proposal.card_count} كارت`, `${proposal.card_count} cards`)}
      </div>
    </li>
  );
}

