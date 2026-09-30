"use client";

import { CalendarPlus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { downloadICS } from "@/lib/export";
import type { Lecture } from "@/lib/db/types";

export function DownloadICS({ lectures }: { lectures: Lecture[] }) {
  const { tr } = useI18n();
  return (
    <button
      onClick={() => downloadICS(lectures, [], "my-schedule.ics")}
      className="flex w-full items-center justify-center gap-1.5 rounded-lg border p-1.5 text-[11px] font-bold text-muted-foreground hover:bg-muted"
    >
      <CalendarPlus className="h-3 w-3" />
      {tr("تصدير التقويم (.ics)", "Export calendar (.ics)")}
    </button>
  );
}
