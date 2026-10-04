"use client";

import { Radio, RadioTower } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { usePush } from "@/hooks/use-push";

/**
 * The switch for reminders that arrive with the app closed.
 *
 * Separate from the bell rather than inside it, for the same reason the sound and
 * screen-wake switches sit beside it: the bell is about the browser allowing a
 * notification at all, and this is about a server being able to send one. They
 * fail independently - a browser can grant the first and never be subscribed for
 * the second - and folding them into one control would mean a green tick that
 * says the wrong thing.
 *
 * It renders nothing at all where push cannot work, rather than showing a switch
 * that fails when pressed. There is nothing useful a student can do about a
 * browser that has no PushManager, and a control that cannot be satisfied is
 * worse than no control.
 */
export function PushToggle({ className }: { className?: string }) {
  const { tr } = useI18n();
  const { state, toggle } = usePush();

  if (state === "unavailable") return null;

  const label =
    state === "on"
      ? tr("التذكير وهيقفل", "Reminders arrive with the app closed")
      : state === "busy"
        ? tr("بنجهّز التذكير…", "Setting reminders up…")
        : tr("فتح التذكير وهيقفل", "Remind me even when the app is closed");

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={state === "on"}
      aria-busy={state === "busy"}
      title={label}
      onClick={() => void toggle()}
      className={className}
    >
      {state === "on" ? (
        <RadioTower className="h-4 w-4 text-emerald-600" />
      ) : (
        <Radio className="h-4 w-4 text-muted-foreground" />
      )}
    </Button>
  );
}