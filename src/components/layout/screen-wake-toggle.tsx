"use client";

import { Sun, SunDim } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { setAlarmPref } from "@/lib/alarm-prefs";
import { useAlarmPrefs } from "@/hooks/use-alarm-prefs";
import { wakeSupported } from "@/lib/screen-wake";

/**
 * The switch that stops the screen from sleeping while the app is open.
 *
 * It only appears where the browser can honour it, and it turns itself off with
 * the tab - a wake lock does not outlive a hidden page, so promising more than
 * that would be a lie.
 */
export function ScreenWakeToggle({ className }: { className?: string }) {
  const { tr } = useI18n();
  const toast = useToast();
  const { wake } = useAlarmPrefs();

  if (!wakeSupported()) return null;

  const label = wake
    ? tr("الشاشة منوّرة طول ما البرنامج فاتح", "Screen stays awake while open")
    : tr("خلّي الشاشة منوّرة", "Keep the screen awake");

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={wake}
      title={label}
      onClick={() => {
        const next = !wake;
        setAlarmPref("wake", next);
        toast({
          title: next
            ? tr("الشاشة هتفضل منوّرة", "The screen will stay awake")
            : tr("هنسمح للشاشة تنام", "The screen may sleep now"),
        });
      }}
      className={className}
    >
      {wake ? (
        <Sun className="h-4 w-4 text-amber-500" />
      ) : (
        <SunDim className="h-4 w-4 text-muted-foreground" />
      )}
    </Button>
  );
}
