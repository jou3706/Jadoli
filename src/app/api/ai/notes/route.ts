import { NextResponse } from "next/server";
import { z } from "zod";
import { completeJson } from "@/lib/ai/providers";
import { extractJson } from "@/lib/ai/extract";
import { buildNotesPrompt } from "@/lib/ai/prompts";
import { loadMaterials, skipReason } from "@/lib/ai/material-fetch";
import { notesSchema, tidyNotes } from "@/lib/ai/notes";
import { taskModel } from "@/lib/ai/routing";
import { guardAiRequest } from "@/lib/ai/rate-limit";

export const runtime = "nodejs";
// Notes are a longer answer than a summary from a longer read of the file, and a
// thirty page scan is the case that pushes this closest to the ceiling.
export const maxDuration = 120;

const bodySchema = z.object({
  materialId: z.string().min(1).max(64),
  language: z.enum(["ar", "en"]).default("ar"),
});

/**
 * One material in, the whole lecture out.
 *
 * Nothing is written: the caller caches the result against the file, because
 * notes are a reading of a file that does not change and a second read of the
 * same PDF should not cost a second call.
 */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const refused = await guardAiRequest(req, raw);
  if (refused) return refused;

  const { materialId, language } = parsed.data;

  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  const loaded = await loadMaterials(req, [{ id: materialId, title: "" }], ac.signal);
  const file = loaded.materials[0];
  if (!file) {
    const s = loaded.skipped[0];
    return NextResponse.json(
      {
        error: s ? `MATERIALS_UNREADABLE:${s.id}` : "MATERIALS_UNREADABLE",
        reason: s?.reason ?? "NOT_FOUND",
        message: skipReason(s?.reason ?? "NOT_FOUND", language),
      },
      { status: 422 },
    );
  }

  try {
    const out = await completeJson(
      taskModel("import", true),
      buildNotesPrompt(language),
      `Write out this lecture as notes: ${file.title || "lecture"}.`,
      [{ dataUrl: file.dataUrl, mime: file.mime }],
      ac.signal,
      true,
    );

    const result = notesSchema.safeParse(extractJson(out));
    if (!result.success) {
      return NextResponse.json(
        { error: "the material could not be read, please try again" },
        { status: 502 },
      );
    }

    const notes = tidyNotes(result.data);
    // A reply that parsed but says nothing is not a lecture, and returning it as
    // an empty success would print a blank sheet and call it a success.
    if (!notes.overview && !notes.sections.length && !notes.formulas.length) {
      return NextResponse.json(
        { error: "there was no readable text in that file" },
        { status: 502 },
      );
    }

    return NextResponse.json(notes);
  } catch (e) {
    const err = e as Error;
    return NextResponse.json(
      { error: err.message || "could not write the lecture out" },
      { status: 500 },
    );
  }
}