import { NextResponse } from "next/server";
import { flashcardsBodySchema } from "@/lib/ai/schema";
import { extractArray } from "@/lib/ai/extract";
import { completeJson } from "@/lib/ai/providers";
import { buildFlashcardsPrompt } from "@/lib/ai/prompts";
import { cleanGeneratedCards } from "@/lib/flashcards";
import { loadMaterials, skipReason } from "@/lib/ai/material-fetch";
import { taskModel } from "@/lib/ai/routing";
import { guardAiRequest } from "@/lib/ai/rate-limit";

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
 * The files are read here rather than sent from the browser: the platform caps a
 * request body at 4.5 MB and base64 adds a third to that, so a lecture PDF
 * uploaded from the client is refused by the host before this code runs - and the
 * refusal is plain text, which the dialog cannot read. See lib/ai/material-fetch.
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

  const refused = await guardAiRequest(req, body);
  if (refused) return refused;

  const { subject, text, materials, count, language } = parsed.data;
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  const loaded = materials.length
    ? await loadMaterials(req, materials, ac.signal)
    : { materials: [], skipped: [] };

  const attached = loaded.materials;

  // Every file asked for failed, and there is nothing else to read. Said plainly,
  // because "no cards" with no reason is indistinguishable from a broken button.
  if (!attached.length && !text.trim() && loaded.skipped.length) {
    const first = loaded.skipped[0];
    return NextResponse.json(
      {
        error: `MATERIALS_UNREADABLE:${first.id}`,
        reason: first.reason,
        message: skipReason(first.reason, language),
      },
      { status: 422 },
    );
  }

  const where = subject.trim();

  // Naming each file lets the prompt ask for cards that trace back to a page,
  // and tells the model which attachment is which when several are attached.
  const listing = attached.map((m, i) => `${i + 1}. ${m.title.trim() || `material ${i + 1}`}`);

  const instruction = [
    `Write up to ${count} revision flashcards${
      where ? ` for the course "${where}"` : ""
    }.`,
    listing.length
      ? [
          listing.length === 1
            ? "The attached file is a set of notes for this course:"
            : `These ${listing.length} attached files are notes for this course:`,
          ...listing,
          "Read the attachments. Base every question on what they actually say.",
        ].join("\n")
      : "",
    text.trim() ? `These are the notes:\n\n"""\n${text.trim()}\n"""` : "",
    listing.length && text.trim()
      ? "The pasted notes and the attachments are the same course; use both."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  let raw: string;
  try {
    raw = await completeJson(
      taskModel("flashcards", attached.length > 0),
      buildFlashcardsPrompt(language, count),
      instruction,
      attached.map((m) => ({ dataUrl: m.dataUrl, mime: m.mime })),
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

  // A file that could not be read is reported, not swallowed: a student told
  // "twelve cards from three files" has to be able to check that.
  const skipped = loaded.skipped.map((s) => ({
    id: s.id,
    title: s.title,
    message: skipReason(s.reason, language),
  }));

  return NextResponse.json({ cards, dropped, skipped });
}