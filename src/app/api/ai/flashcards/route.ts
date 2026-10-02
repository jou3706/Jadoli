import { NextResponse } from "next/server";
import { flashcardsBodySchema } from "@/lib/ai/schema";
import { extractArray } from "@/lib/ai/extract";
import { completeJson } from "@/lib/ai/providers";
import { buildFlashcardsPrompt } from "@/lib/ai/prompts";
import { cleanGeneratedCards } from "@/lib/flashcards";
import type { ModelId } from "@/lib/ai/models";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * Materials in, cards out.
 *
 * Returns cards and nothing else: no ids, no scheduling, no writes. A student
 * reads every question before it goes into their queue, and a card that arrives
 * already booked for a date is a card they cannot throw away without also
 * cancelling a session.
 *
 * The attachments arrive as bytes rather than as material URLs on purpose. A URL
 * in the prompt is not opened by the model, it is treated as text, so asking
 * questions about "https://…" produces questions about the string
 * "https://…". Whatever reads the file does it before this point.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = flashcardsBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const { model, subject, text, materials, count, language } = parsed.data;
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  const where = subject.trim();

  // Naming each file lets the prompt ask for cards that trace back to a page,
  // and tells the model which attachment is which when several are attached.
  const attached = materials.map(
    (m, i) => `${i + 1}. ${m.title.trim() || `material ${i + 1}`}`,
  );

  const instruction = [
    `Write up to ${count} revision flashcards${
      where ? ` for the course "${where}"` : ""
    }.`,
    materials.length
      ? [
          attached.length === 1
            ? "The attached file is a set of notes for this course:"
            : `These ${attached.length} attached files are notes for this course:`,
          ...attached,
          "Read the attachments. Base every question on what they actually say.",
        ].join("\n")
      : "",
    text.trim() ? `These are the notes:\n\n"""\n${text.trim()}\n"""` : "",
    materials.length && text.trim()
      ? "The pasted notes and the attachments are the same course; use both."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  let raw: string;
  try {
    raw = await completeJson(
      model as ModelId,
      buildFlashcardsPrompt(language, count),
      instruction,
      materials.map((m) => ({ dataUrl: m.dataUrl, mime: m.mime })),
      ac.signal,
    );
  } catch (e) {
    const err = e as Error;
    return NextResponse.json(
      { error: err.message || "Could not make cards" },
      { status: 502 },
    );
  }

  const { cards, dropped } = cleanGeneratedCards(extractArray(raw), { limit: count });

  return NextResponse.json({ cards, dropped });
}