import { NextResponse } from "next/server";
import { completeJson } from "@/lib/ai/providers";
import { buildQuizPrompt } from "@/lib/ai/prompts";
import { quizSetSchema, quizSourceSchema } from "@/lib/ai/schema";
import { loadMaterials, skipReason } from "@/lib/ai/material-fetch";
import type { ModelId } from "@/lib/ai/models";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = quizSourceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const src = parsed.data;

  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  let loaded: Awaited<ReturnType<typeof loadMaterials>> | null = null;
  if (src.source === "material" && src.materialIds.length) {
    loaded = await loadMaterials(
      req,
      src.materialIds.map((id) => ({ id, title: "" })),
      ac.signal,
    );
  }

  // Nothing loaded and something was asked for: the student is owed the reason,
  // not an empty exam.
  if (loaded && loaded.materials.length === 0 && loaded.skipped.length > 0) {
    const s = loaded.skipped[0];
    return NextResponse.json(
      {
        error: `MATERIALS_UNREADABLE:${s.id}`,
        reason: s.reason,
        message: skipReason(s.reason, src.language === "en" ? "en" : "ar"),
      },
      { status: 422 },
    );
  }

  const attached = loaded?.materials ?? [];

  const parts: string[] = [];
  parts.push(`language: ${src.language}`);
  parts.push(`count: ${src.count}`);
  if (src.source === "topic" && src.topic) {
    parts.push(`topic: ${src.topic}`);
  }
  if (src.source === "chapter" && src.chapter) {
    parts.push(`chapter: ${src.chapter}`);
  }
  if (src.subjectKey) {
    parts.push(`subject: ${src.subjectKey}`);
  }
  // Naming each file tells the model which attachment is which, the same way the
  // flashcards route does.
  if (attached.length) {
    parts.push(`material_count: ${attached.length}`);
    attached.forEach((m, i) => parts.push(`material ${i + 1}: ${m.title || "material"}`));
  }

  const user = parts.join("\n");

  try {
    const raw = await completeJson(
      "gemini-35-flash" as ModelId,
      buildQuizPrompt(src.language),
      user,
      attached.length ? attached.map((m) => ({ dataUrl: m.dataUrl, mime: m.mime })) : undefined,
      ac.signal,
    );
    const parsed = quizSetSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "invalid quiz format");
    }
    return NextResponse.json(parsed.data);
  } catch (e) {
    const err = e as Error;
    return NextResponse.json({ error: err.message || "generation failed" }, { status: 500 });
  }
}
