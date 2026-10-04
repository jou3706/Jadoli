import { NextResponse } from "next/server";
import { z } from "zod";
import { completeJson } from "@/lib/ai/providers";
import { extractJson } from "@/lib/ai/extract";
import { buildSyllabusPrompt } from "@/lib/ai/prompts";
import { loadMaterials, skipReason } from "@/lib/ai/material-fetch";
import { syllabusDrafts, syllabusResultSchema } from "@/lib/ai/syllabus";
import { taskModel } from "@/lib/ai/routing";
import { guardAiRequest } from "@/lib/ai/rate-limit";
import { isoDate, nowCairo } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 90;

const bodySchema = z.object({
  materialId: z.string().min(1).max(64),
  subject: z.string().max(120).default(""),
  language: z.enum(["ar", "en"]).default("ar"),
});

/**
 * A syllabus in, dated events out — as a proposal, never as a write.
 *
 * The student confirms every row on screen before anything is saved. That is the
 * whole design: a model reading a course outline is good at finding the exam
 * date and bad at admitting when the file only says "week 7", so the rows are
 * reviewed rather than trusted.
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

  const { materialId, subject, language } = parsed.data;

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

  const today = isoDate(nowCairo());

  try {
    const out = await completeJson(
      taskModel("import", true),
      buildSyllabusPrompt(today, subject.trim()),
      [
        `Read the attached syllabus: ${file.title || "syllabus"}.`,
        `List every dated thing in it for ${language === "en" ? "English" : "Arabic"}.`,
      ].join("\n"),
      [{ dataUrl: file.dataUrl, mime: file.mime }],
      ac.signal,
      true,
    );

    const result = syllabusResultSchema.safeParse(extractJson(out));
    if (!result.success) {
      return NextResponse.json(
        { error: "the syllabus could not be read, please try again" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      subject: subject.trim(),
      title: file.title,
      events: syllabusDrafts(result.data.events, {
        today,
        fallbackSubject: subject.trim() || undefined,
      }),
    });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json(
      { error: err.message || "could not read the syllabus" },
      { status: 500 },
    );
  }
}