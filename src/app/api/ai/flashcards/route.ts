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
 * Notes in, cards out.
 *
 * Returns cards and nothing else: no ids, no scheduling, no writes. A student
 * reads every question before it goes into their queue, and a card that arrives
 * already booked for a date is a card they cannot throw away without also
 * cancelling a session.
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

  const { model, subject, text, images, count, language } = parsed.data;
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  const where = subject.trim();
  const instruction = [
    `Write up to ${count} revision flashcards${
      where ? ` for the course "${where}"` : ""
    }.`,
    text.trim() ? `These are the notes:\n\n"""\n${text.trim()}\n"""` : "",
    images.length ? "The attached pages are part of the same set of notes." : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  let raw: string;
  try {
    raw = await completeJson(
      model as ModelId,
      buildFlashcardsPrompt(language, count),
      instruction,
      images.map((i) => ({ dataUrl: i.dataUrl, mime: i.mime })),
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