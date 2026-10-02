"use client";

import { useEffect, useState } from "react";
import { AlarmClock, BellRing, Volume2, VolumeX } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { cn, formatTime } from "@/lib/utils";
import { kindLabel, shortDate } from "@/lib/subject-events";
import { SNOOZE_MINUTES } from "@/lib/alarm";
import {
  previewChime,
  soundSupported,
  soundUnlocked,
  unlockSound,
} from "@/lib/alarm-sound";
import { useEventAlarms } from "@/hooks/use-event-alarms";

/** "in 58 minutes", counting down while it rings. */
function liveCountdown(target: number, now: number) {
  const minutes = Math.max(0, Math.round((target - now) / 60_000));
  if (minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * What an alarm looks like when it is ringing.
 *
 * A full overlay rather than a toast, because a toast is what you look past.
 * The two answers are the two real ones - stop it, or make it wait - and both
 * are one tap, with the one that silences it not the smaller of the two.
 */
export function AlarmOverlay({
  ringing,
  now,
  onStop,
  onSnooze,
  unlocked,
  onEnable,
}: {
  ringing: {
    event: {
      title: string;
      subject_key: string;
      date: string;
      start_time: string;
      kind: string;
    };
    at: number;
  };
  now: Date;
  onStop: () => void;
  onSnooze: (minutes?: number) => void;
  unlocked: boolean;
  onEnable: () => Promise<boolean>;
}) {
  const { tr, lang } = useI18n();
  const { event } = ringing;
  const start = new Date(
    `${event.date}T${event.start_time || "12:00"}:00`,
  );
  const valid = !Number.isNaN(start.getTime());

  // A keyboard shortcut, because the alarm is exactly the moment a person is
  // not reading and reaching for the mouse is one thing too many.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onStop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStop]);

  const left = valid ? liveCountdown(start.getTime(), now.getTime()) : "";

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-label={tr("منبه حدث", "Event alarm")}
      className="fixed inset-x-0 bottom-0 z-[100] flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="w-full max-w-md rounded-2xl border-2 border-rose-500/60 bg-card p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="relative mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-300">
            <BellRing className="h-5 w-5 animate-pulse" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-300">
              {tr("منبه", "Alarm")}
            </p>
            <h3 className="truncate font-display text-lg font-bold leading-tight">
              {event.title}
            </h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span>{event.subject_key}</span>
              <span aria-hidden>·</span>
              <span>{kindLabel(event.kind, lang)}</span>
              <span aria-hidden>·</span>
              <span>{shortDate(event.date, lang)}</span>
              {event.start_time && (
                <>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">
                    {formatTime(event.start_time)}
                  </span>
                </>
              )}
              {left && <span>{tr(`بعد ${left}`, `in ${left}`)}</span>}
            </p>
            {!valid && (
              <p className="mt-1 text-xs text-muted-foreground">
                {tr("مفيش وقت محدد", "No time set")}
              </p>
            )}
          </div>
        </div>

        {/*
          A browser that has never been asked to make a sound will not make one,
          however loud the alarm asks. Saying so here, at the moment it matters,
          with a button that works - is far better than an alarm that rings
          silently and looks broken.
        */}
        {!unlocked && (
          <Button
            variant="outline"
            onClick={() => void onEnable()}
            className="mt-2 h-11 w-full border-amber-500/60 text-amber-700 dark:text-amber-300"
          >
            <Volume2 className="h-4 w-4" />
            {tr("شغّل صوت المنبه", "Turn on the alarm sound")}
          </Button>
        )}

        <div className="mt-4 flex gap-2">
          <Button
            onClick={onStop}
            className="h-11 flex-1 bg-rose-600 text-base font-bold hover:bg-rose-700"
          >
            {tr("إيقاف", "Stop")}
          </Button>
          <Button
            variant="outline"
            onClick={() => onSnooze(SNOOZE_MINUTES)}
            className={cn("h-11 flex-1")}
          >
            <AlarmClock className="h-4 w-4" />
            {tr(`بعد ${SNOOZE_MINUTES} د`, `In ${SNOOZE_MINUTES} min`)}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The alarm, mounted once for every page inside the app.
 *
 * One copy on purpose. An alarm that belonged to whichever page happened to be
 * mounted would go quiet the moment you opened another one, which is the one
 * moment it matters.
 */
export function EventAlarms() {
  const { ringing, now, stop, snooze, enableSound, unlocked } = useEventAlarms();

  // Nothing shown until it is wanted: an app that has to be dismissed before it
  // is used is an app that gets dismissed.
  return ringing ? (
    <AlarmOverlay
      ringing={ringing}
      now={now}
      onStop={stop}
      onSnooze={snooze}
      unlocked={unlocked}
      onEnable={enableSound}
    />
  ) : null;
}

/**
 * The one control that turns the sound on.
 *
 * Separate from the notification bell because they are different permissions:
 * a browser will show a notification you were allowed while still refusing to
 * make a sound nobody has tapped for. So the button says which of the two you
 * have, and pressing it plays a chime - otherwise "it is on" is a claim nobody
 * can check.
 *
 * Standalone on purpose. It reads the audio state from the sound module rather
 * than from the alarm hook, because a second copy of the hook would be a second
 * alarm, and two alarms is one too many.
 */
export function AlarmSoundToggle({ className }: { className?: string }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(soundSupported());
    setUnlocked(soundUnlocked());
  }, []);

  if (!supported) return null;

  const label = unlocked
    ? tr("صوت المنبه شغال", "Alarm sound is on")
    : tr("فعّل صوت المنبه", "Turn on alarm sound");

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const ok = await unlockSound();
        setUnlocked(ok);
        if (ok) previewChime();
        setBusy(false);
        toast(
          ok
            ? { title: tr("صوت المنبه شغال", "Alarm sound is on") }
            : {
                title: tr("مقدرناش نشغّل الصوت", "Could not turn the sound on"),
                description: tr(
                  "المتصفح رفض تشغيل الصوت",
                  "The browser refused to play sound",
                ),
                variant: "destructive",
              },
        );
      }}
      className={className}
    >
      {unlocked ? (
        <Volume2 className="h-4 w-4 text-emerald-600" />
      ) : (
        <VolumeX className="h-4 w-4 text-amber-600" />
      )}
    </Button>
  );
}
