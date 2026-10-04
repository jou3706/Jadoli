"use client";

import { useEffect, useRef, useState } from "react";
import { downloadCanvasPdf, nodeToCanvas } from "@/lib/export";
import { printFileName, type PrintDoc } from "@/lib/print-doc";
import { useToast } from "@/components/ui/toast";

/**
 * Printing a document, once, wherever it was built.
 *
 * The sheet is laid out in the page, off to the side where nobody can see it,
 * and then measured. It is never `display: none`: html2canvas renders from the
 * element's own box, and an element that is not laid out has no box, so a hidden
 * one photographs as a blank sheet.
 *
 * The capture is driven by an effect on the document rather than by straight
 * after asking for it: React has not laid the node out at the moment the caller
 * returns, and a photograph taken of a node that has not been laid out is a
 * photograph of nothing.
 */
export function usePrintPdf(language: "ar" | "en") {
  const toast = useToast();
  const [pending, setPending] = useState<{ doc: PrintDoc; filename: string } | null>(null);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pending) return;
    const { filename } = pending;

    void (async () => {
      try {
        const node = sheet.current;
        if (!node) throw new Error("the sheet was not laid out");
        const canvas = await nodeToCanvas(node);
        await downloadCanvasPdf(canvas, filename);
        toast({
          title: language === "ar" ? "نزّلنا الملف" : "File saved",
          description:
            language === "ar"
              ? "الملف اتحفظ في مجلد التحميلات."
              : "The file is in your downloads.",
        });
      } catch (e) {
        toast({
          title: language === "ar" ? "مقدرناش نعمل الـPDF" : "Could not make the PDF",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      } finally {
        setPending(null);
      }
    })();
  }, [pending, language, toast]);

  /**
   * Print it, once it is laid out.
   *
   * The title is the material's own, so the file is named after the thing the
   * student will look for later rather than after the button they pressed.
   */
  const print = (doc: PrintDoc, title: string) => {
    setPending({ doc, filename: printFileName(title) });
  };

  const fail = (description: string) =>
    toast({
      title: language === "ar" ? "مقدرناش نعمل الملف" : "Could not make the file",
      description,
      variant: "destructive",
    });

  /** True while the sheet is being measured, which is not the same as reading. */
  const printing = pending !== null;

  return { printing, pending, sheet, print, fail };
}