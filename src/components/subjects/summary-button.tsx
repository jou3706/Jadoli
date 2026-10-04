"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { authHeader } from "@/lib/db/supabase-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { downloadCanvasPdf, nodeToCanvas } from "@/lib/export";
import { buildSummaryDoc, isEmptyDoc, summaryFileName, type SummaryDoc } from "@/lib/summary-doc";
import { readCachedSummary, writeCachedSummary, type MaterialSummary } from "@/lib/ai/summary";
import { detectKind } from "@/lib/materials";
import type { Material } from "@/lib/db/types";

/**
 * A summary, handed over as a page of paper.
 *
 * The file is built here rather than on the server for two reasons that both
 * point the same way. The student already has the material and the summary cached
 * on their own device, so a second read of the same file is free and instant -
 * there is no model to call and nothing to upload. And the PDF is drawn by
 * photographing a real DOM node, which is the only way out of jsPDF to get Arabic
 * to come out as Arabic rather than as unshaped letters in the wrong order.
 *
 * So the sheet is laid out in the page, off to the side where nobody can see it,
 * and then measured. It is never `display: none`: html2canvas renders from the
 * element's own box, and an element that is not laid out has no box, so a hidden
 * one photographs as a blank sheet.
 */

/** A4 at the 96 dots per inch the browser lays out at, which is what a photo is scaled from. */
const SHEET_WIDTH = 794;

type Props = { material: Material | null };

/** Today's date, in the reader's language, with Latin digits like the rest of the app. */
function dateLabel(language: "ar" | "en"): string {
  try {
    return new Intl.DateTimeFormat(language === "ar" ? "ar" : "en-GB", {
      dateStyle: "long",
      numberingSystem: "latn",
    }).format(new Date());
  } catch {
    return "";
  }
}

export function SummaryButton({ material }: Props) {
  const { lang } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [doc, setDoc] = useState<SummaryDoc | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const wanted = useRef("");

  const language = lang === "en" ? "en" : "ar";

  /** The summary, from the cache when the file has already been read. */
  const summaryFor = useCallback(
    async (m: Material): Promise<MaterialSummary> => {
      const cached = readCachedSummary(m.id);
      if (cached) return cached;

      const res = await fetch("/api/ai/summary", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ materialId: m.id, language }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body.message || body.reason || body.error || "the file could not be read",
        );
      }
      const next: MaterialSummary = {
        summary: body.summary ?? "",
        keyPoints: body.keyPoints ?? [],
        glossary: body.glossary ?? [],
      };
      writeCachedSummary(m.id, next);
      return next;
    },
    [language],
  );

  /**
   * Measured once the sheet is actually on the page.
   *
   * Driven by an effect on the document rather than straight after setting it:
   * React has not laid the node out at the moment the click handler returns, and
   * a photograph taken of a node that has not been laid out is a photograph of
   * nothing.
   */
  useEffect(() => {
    if (!doc || !wanted.current) return;
    const filename = wanted.current;
    wanted.current = "";

    void (async () => {
      try {
        const node = sheet.current;
        if (!node) throw new Error("the sheet was not laid out");
        const canvas = await nodeToCanvas(node);
        await downloadCanvasPdf(canvas, filename);
        toast({
          title:
            language === "ar" ? "نزّلنا الملخص" : "Summary saved",
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
        setDoc(null);
        setBusy(false);
      }
    })();
  }, [doc, language, toast]);

  const run = async () => {
    if (!material || busy) return;
    setBusy(true);
    try {
      const summary = await summaryFor(material);
      const built = buildSummaryDoc({
        summary,
        title: material.title,
        course: material.subject_key,
        language,
        dateLabel: dateLabel(language),
      });
      if (isEmptyDoc(built)) {
        toast({
          title:
            language === "ar" ? "مفيش نص يُلخّص" : "Nothing to summarise",
          description:
            language === "ar"
              ? "الملف ده مفيهوش نص مقروء."
              : "There was no readable text in that file.",
          variant: "destructive",
        });
        setBusy(false);
        return;
      }
      wanted.current = summaryFileName(material.title);
      setDoc(built);
    } catch (e) {
      toast({
        title: language === "ar" ? "مقدرناش نلخّص" : "Could not summarise",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      setBusy(false);
    }
  };

  if (!material?.file_path || detectKind(material.url, material.type) === "video") return null;

  const label = language === "ar" ? "لخّص الملف PDF" : "Summarise as a PDF";

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        disabled={busy}
        onClick={() => void run()}
        aria-label={label}
        title={
          language === "ar"
            ? "ملخص وأهم النقاط والمصطلحات في ملف PDF"
            : "Summary, key points and vocabulary as a PDF"
        }
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <FileDown className="h-3.5 w-3.5" />
        )}
      </Button>

      {doc && <Sheet doc={doc} innerRef={sheet} />}
    </>
  );
}

/**
 * The page.
 *
 * Colours are written out rather than themed: the app has a dark mode and paper
 * does not, so anything left to the theme would come out of a dark-mode print as
 * white text on a white sheet - a blank page with no error. Direction comes from
 * the document's own language, so the Arabic sheet reads right to left and the
 * English one does not.
 */
function Sheet({
  doc,
  innerRef,
}: {
  doc: SummaryDoc;
  innerRef: React.Ref<HTMLDivElement>;
}) {
  const rtl = doc.language === "ar";
  return (
    <div
      ref={innerRef}
      aria-hidden
      style={{
        position: "fixed",
        top: 0,
        // Off to the side rather than `display: none`, because html2canvas draws
        // the element's own box and an unlaid-out element has none.
        left: -10000,
        width: SHEET_WIDTH,
        background: "#ffffff",
        color: "#0f172a",
        zIndex: -1,
        pointerEvents: "none",
      }}
    >
      <div
        dir={rtl ? "rtl" : "ltr"}
        style={{
          fontFamily: "var(--font-body), Tajawal, sans-serif",
          padding: "56px 60px",
          boxSizing: "border-box",
        }}
      >
        <header style={{ borderBottom: "2px solid #e2e8f0", paddingBottom: 20 }}>
          <h1
            style={{
              fontFamily: "var(--font-heading), Cairo, sans-serif",
              fontSize: 26,
              lineHeight: 1.4,
              margin: 0,
              fontWeight: 700,
              color: "#0f172a",
            }}
          >
            {doc.title}
          </h1>
          {doc.course && (
            <p style={{ fontSize: 15, margin: "6px 0 0", color: "#475569" }}>{doc.course}</p>
          )}
          <p style={{ fontSize: 12, margin: "12px 0 0", color: "#94a3b8" }}>
            {`${rtl ? "تم الاستخراج" : "Extracted"} · ${doc.dateLabel}`}
          </p>
        </header>

        {doc.blocks.map((block, i) => (
          <section key={i} style={{ marginTop: 32 }}>
            <h2
              style={{
                fontFamily: "var(--font-heading), Cairo, sans-serif",
                fontSize: 16,
                fontWeight: 700,
                margin: "0 0 12px",
                color: "#0f172a",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 4,
                  height: 18,
                  borderRadius: 2,
                  background: "#0ea5e9",
                }}
              />
              {block.heading}
            </h2>

            {block.kind === "paragraphs" &&
              block.lines.map((line, j) => (
                <p
                  key={j}
                  style={{
                    fontSize: 15,
                    // Generous leading: Arabic ascenders and descenders need more
                    // room than Latin ones, and a tight line in a printed summary
                    // is unreadable in a way a tight line on screen is not.
                    lineHeight: 1.95,
                    margin: "0 0 14px",
                    textAlign: rtl ? "justify" : "left",
                    color: "#1e293b",
                  }}
                >
                  {line}
                </p>
              ))}

            {block.kind === "points" && (
              <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {block.items.map((item, j) => (
                  <li
                    key={j}
                    style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "flex-start" }}
                  >
                    <span
                      style={{
                        flex: "0 0 auto",
                        width: 22,
                        height: 22,
                        borderRadius: 999,
                        background: "#e0f2fe",
                        color: "#0369a1",
                        fontSize: 12,
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 2,
                      }}
                    >
                      {j + 1}
                    </span>
                    <span style={{ fontSize: 15, lineHeight: 1.8, color: "#1e293b" }}>{item}</span>
                  </li>
                ))}
              </ol>
            )}

            {block.kind === "terms" && (
              <dl style={{ margin: 0, borderTop: "1px solid #e2e8f0" }}>
                {block.rows.map((row, j) => (
                  <div
                    key={j}
                    style={{
                      display: "flex",
                      gap: 16,
                      padding: "11px 0",
                      borderBottom: "1px solid #f1f5f9",
                      alignItems: "baseline",
                    }}
                  >
                    <dt
                      style={{
                        flex: "0 0 34%",
                        fontSize: 14,
                        // The last row is the closing note rather than a term, so
                        // it is set apart instead of being coloured like one.
                        fontWeight: row.term ? 700 : 400,
                        fontStyle: row.term ? "normal" : "italic",
                        color: row.term ? "#0369a1" : "#94a3b8",
                      }}
                    >
                      {row.term}
                    </dt>
                    <dd style={{ margin: 0, fontSize: 14, lineHeight: 1.75, color: "#334155" }}>
                      {row.meaning}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}