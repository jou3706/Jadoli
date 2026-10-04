"use client";

import type { PrintDoc } from "@/lib/print-doc";

/**
 * The page.
 *
 * Both printable things in the app are drawn by this, so a summary and a lecture
 * cannot drift apart in how they look.
 *
 * Colours are written out rather than themed: the app has a dark mode and paper
 * does not, so anything left to the theme would come out of a dark-mode print as
 * white text on a white sheet - a blank page with no error. Direction comes from
 * the document's own language, so the Arabic sheet reads right to left and the
 * English one does not.
 */

/** A4 at the 96 dots per inch the browser lays out at, which is what a photo is scaled from. */
const SHEET_WIDTH = 794;

const INK = "#0f172a";
const BODY = "#1e293b";
const MUTED = "#64748b";
const RULE = "#e2e8f0";
const ACCENT = "#0284c7";

const font = (heading: boolean) =>
  `var(--font-${heading ? "heading" : "body"}), ${heading ? "Cairo" : "Tajawal"}, sans-serif`;

export function PrintSheet({
  doc,
  innerRef,
}: {
  doc: PrintDoc;
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
        color: INK,
        zIndex: -1,
        pointerEvents: "none",
      }}
    >
      <div
        dir={rtl ? "rtl" : "ltr"}
        style={{ fontFamily: font(false), padding: "56px 60px", boxSizing: "border-box" }}
      >
        <header style={{ borderBottom: `2px solid ${RULE}`, paddingBottom: 20 }}>
          <h1
            style={{
              fontFamily: font(true),
              fontSize: 26,
              lineHeight: 1.4,
              margin: 0,
              fontWeight: 700,
              color: INK,
            }}
          >
            {doc.title}
          </h1>
          {doc.course && (
            <p style={{ fontSize: 15, margin: "6px 0 0", color: MUTED }}>{doc.course}</p>
          )}
          <p style={{ fontSize: 12, margin: "12px 0 0", color: "#94a3b8" }}>{doc.dateLabel}</p>
        </header>

        {doc.blocks.map((block, i) => (
          <section key={i} style={{ marginTop: 30 }}>
            {block.heading && (
              <h2
                style={{
                  fontFamily: font(true),
                  fontSize: 16,
                  fontWeight: 700,
                  margin: "0 0 12px",
                  color: INK,
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
                    background: ACCENT,
                  }}
                />
                {block.heading}
              </h2>
            )}

            {block.kind === "paragraphs" &&
              block.lines.map((line, j) => (
                <p
                  key={j}
                  style={{
                    fontSize: 15,
                    // Generous leading: Arabic ascenders and descenders need more
                    // room than Latin ones, and a tight line in a printed lecture
                    // is unreadable in a way a tight line on screen is not.
                    lineHeight: 1.95,
                    margin: "0 0 14px",
                    textAlign: rtl ? "justify" : "left",
                    color: BODY,
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
                    <Badge>{j + 1}</Badge>
                    <span style={{ fontSize: 15, lineHeight: 1.8, color: BODY }}>{item}</span>
                  </li>
                ))}
              </ol>
            )}

            {block.kind === "table" && (
              <div>
                {block.caption && (
                  <p
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      margin: "0 0 8px",
                      color: MUTED,
                    }}
                  >
                    {block.caption}
                  </p>
                )}
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    // A wide grid of prose at one size is unreadable, and the
                    // columns are fixed, so the type gives ground as they grow.
                    fontSize: block.columns.length > 5 ? 11 : block.columns.length > 3 ? 12 : 13,
                    tableLayout: "fixed",
                  }}
                >
                  <thead>
                    <tr>
                      {block.columns.map((c, j) => (
                        <th
                          key={j}
                          style={{
                            border: `1px solid ${RULE}`,
                            background: "#f1f5f9",
                            padding: "9px 12px",
                            textAlign: "start",
                            fontWeight: 700,
                            color: INK,
                            fontFamily: font(true),
                          }}
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, i) => (
                      <tr key={i} style={{ background: i % 2 ? "#f8fafc" : "#ffffff" }}>
                        {row.map((cell, j) => (
                          <td
                            key={j}
                            style={{
                              border: `1px solid ${RULE}`,
                              padding: "9px 12px",
                              lineHeight: 1.6,
                              color: BODY,
                              verticalAlign: "top",
                            }}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {block.kind === "callout" && (
              <div
                style={{
                  background: "#f0f9ff",
                  border: `1px solid #bae6fd`,
                  borderInlineStart: `4px solid ${ACCENT}`,
                  borderRadius: 12,
                  padding: "18px 20px",
                }}
              >
                <p
                  style={{
                    fontFamily: font(true),
                    fontSize: 13,
                    fontWeight: 700,
                    margin: "0 0 10px",
                    color: "#075985",
                  }}
                >
                  {block.heading}
                </p>
                {block.items.map((item, j) => (
                  <p
                    key={j}
                    style={{
                      fontSize: 14,
                      lineHeight: 1.85,
                      margin: j === block.items.length - 1 ? 0 : "0 0 8px",
                      color: "#0c4a6e",
                    }}
                  >
                    {item}
                  </p>
                ))}
              </div>
            )}

            {block.kind === "terms" && (
              <dl style={{ margin: 0, borderTop: `1px solid ${RULE}` }}>
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
                        color: row.term ? ACCENT : "#94a3b8",
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

            {block.kind === "formulas" && (
              <div style={{ display: "grid", gap: 12 }}>
                {block.rows.map((row, j) => (
                  <div
                    key={j}
                    style={{
                      background: "#f8fafc",
                      border: `1px solid ${RULE}`,
                      borderRadius: 10,
                      padding: "14px 18px",
                    }}
                  >
                    {row.label && (
                      <p
                        style={{
                          fontSize: 12,
                          margin: "0 0 8px",
                          color: MUTED,
                          fontWeight: 700,
                        }}
                      >
                        {row.label}
                      </p>
                    )}
                    <p
                      dir="auto"
                      style={{
                        fontSize: 16,
                        lineHeight: 1.7,
                        margin: 0,
                        color: INK,
                        // The material's own notation, which may be LaTeX or may be
                        // plain text. Either way it is not this app's to reformat,
                        // so it is set as a formula reads rather than as prose.
                        fontFamily:
                          '"Cambria Math", "Latin Modern Math", Georgia, var(--font-body), serif',
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {row.expression}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

/** The number in a numbered line. */
function Badge({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </span>
  );
}