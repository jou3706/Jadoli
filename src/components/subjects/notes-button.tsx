"use client";

import { useCallback, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { usePrintPdf } from "@/components/print/use-print-pdf";
import { PrintSheet } from "@/components/print/print-sheet";
import { buildNotesDoc } from "@/lib/notes-doc";
import { isEmptyDoc } from "@/lib/print-doc";
import { readCachedNotes, writeCachedNotes, type MaterialNotes } from "@/lib/ai/notes";
import type { Material } from "@/lib/db/types";
import { canSummarise, todayLabel, useMaterialRead } from "@/components/print/material-read";

/**
 * The whole lecture, handed over as a page of paper.
 *
 * The same reading as the summary button and a different artifact: this one is
 * the lecture in the order it was given, under headings, rather than an
 * orientation to it. It is the one that costs a call, so the result is cached
 * against the file and the second press of this button is free - the same trade
 * the summary button makes.
 */
export function NotesButton({ material }: { material: Material | null }) {
  const { lang } = useI18n();
  const language = lang === "en" ? "en" : "ar";
  const [reading, setReading] = useState(false);
  const { printing, pending, sheet, print, fail } = usePrintPdf(language);
  const read = useMaterialRead();

  const notesFor = useCallback(
    async (m: Material): Promise<MaterialNotes> => {
      const cached = readCachedNotes(m.id);
      if (cached) return cached;
      const next = await read<MaterialNotes>(m, "/api/ai/notes", language);
      writeCachedNotes(m.id, next);
      return next;
    },
    [language, read],
  );

  const run = async () => {
    if (!material || reading) return;
    setReading(true);
    try {
      const notes = await notesFor(material);
      const doc = buildNotesDoc({
        notes,
        title: material.title,
        course: material.subject_key,
        language,
        dateLabel: todayLabel(language),
      });
      if (isEmptyDoc(doc)) {
        fail(
          language === "ar"
            ? "الملف ده مفيهوش نص مقروء."
            : "There was no readable text in that file.",
        );
        return;
      }
      print(doc, material.title);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  };

  if (!canSummarise(material)) return null;

  const spinner = reading || printing;
  const label = language === "ar" ? "اكتب المحاضرة كاملة PDF" : "Write out the whole lecture";

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        disabled={spinner}
        onClick={() => void run()}
        aria-label={label}
        title={
          language === "ar"
            ? "المحاضرة كاملة في أقسام مع الصيغ والخلاصة"
            : "The whole lecture, in sections, with its formulas and takeaways"
        }
      >
        {spinner ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <FileText className="h-3.5 w-3.5" />
        )}
      </Button>

      {pending && <PrintSheet doc={pending.doc} innerRef={sheet} />}
    </>
  );
}