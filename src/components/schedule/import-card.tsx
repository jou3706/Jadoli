"use client";

import Link from "next/link";
import { Sparkles, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

/** Shown on the schedule page when there is no data yet. */
export function ImportCard() {
  const { tr } = useI18n();
  return (
    <div className="rounded-2xl border border-dashed bg-card p-8 text-center">
      <Sparkles className="mx-auto h-8 w-8 text-primary" />
      <h2 className="mt-3 font-display text-xl font-bold">
        {tr("ابدأ بجدولك", "Start with your schedule")}
      </h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {tr(
          "صوّر الجدول أو ارفعه PDF والمساعد هيقراه ويملأ الجدول تلقائيًا.",
          "Snap or upload your timetable as a PDF and the assistant will read it and fill the schedule for you.",
        )}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href="/import">
            <Upload className="h-4 w-4" /> {tr("استيراد الجدول", "Import schedule")}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/assistant">
            <Sparkles className="h-4 w-4" /> {tr("اسأل المساعد", "Ask the assistant")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
