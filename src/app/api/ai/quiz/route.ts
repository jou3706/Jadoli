import { NextResponse } from "next/server";
import { completeJson } from "@/lib/ai/providers";
import { buildQuizPrompt } from "@/lib/ai/prompts";
import { quizSetSchema, quizSourceSchema } from "@/lib/ai/schema";
import { loadMaterials } from "@/lib/ai/material-fetch";
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
  if (src.source === "material" && src.materialId) {
    loaded = await loadMaterials(req, [{ id: src.materialId, title: src.materialTitle || "" }], ac.signal);
  }

  if (loaded && loaded.materials.length === 0 && loaded.skipped.length > 0) {
    const s = loaded.skipped[0];
    return NextResponse.json({ error: `MATERIALS_UNREADABLE:${s.id}`, reason: s.reason }, { status: 422 });
  }

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
  if (src.source === "material" && src.materialTitle) {
    parts.push(`material_title: ${src.materialTitle}`);
  }

  const user = parts.join("\n");

  try {
    const raw = await completeJson(
      "gemini-35-flash" as ModelId,
      buildQuizPrompt(src.language),
      user,
      undefined,
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
