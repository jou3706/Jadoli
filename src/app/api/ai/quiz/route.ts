import { NextResponse } from "next/server";
import { completeJson } from "@/lib/ai/providers";
import { extractJson } from "@/lib/ai/extract";
import { buildQuizPrompt, buildVerdictPrompt } from "@/lib/ai/prompts";
import { quizSetSchema, quizSourceSchema, type QuizSet } from "@/lib/ai/schema";
import { loadMaterials, skipReason } from "@/lib/ai/material-fetch";
import { taskModel, verifierFor } from "@/lib/ai/routing";
import { applyFixes, parseVerdict, verdictInput } from "@/lib/ai/quiz-verify";

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
    const system = buildQuizPrompt(src.language);
    const images = attached.length
      ? attached.map((m) => ({ dataUrl: m.dataUrl, mime: m.mime }))
      : undefined;
    // A marked answer the material does not support is the one failure a student
    // cannot see for themselves, so the key is checked before it is handed over.
    // Two models from two providers rarely mis-mark the same question, which is
    // the whole value of asking the second one.
    const writer = taskModel("quiz", attached.length > 0);
    const checker = verifierFor(writer);
    // The provider is asked for JSON and extracts the first balanced value, but a
    // model can still slip once. A single retry turns a formatting hiccup into an
    // exam instead of an error the student cannot act on.
    let set: QuizSet | null = null;
    for (let attempt = 0; attempt < 2 && !set; attempt += 1) {
      const raw = await completeJson(writer, system, user, images, ac.signal, true);
      const parsed = quizSetSchema.safeParse(extractJson(raw));
      if (parsed.success) set = parsed.data;
    }
    if (!set) {
      return NextResponse.json(
        { error: "the model did not return a usable exam, please try again" },
        { status: 502 },
      );
    }

    // Best effort by design: a checker that is unavailable, slow or unhelpful
    // must not cost the student an exam that has already been written.
    let checked = set;
    let corrected = 0;
    try {
      const verdict = await completeJson(
        checker,
        buildVerdictPrompt(src.language === "en" ? "en" : "ar"),
        verdictInput(set),
        undefined,
        ac.signal,
        true,
      );
      const applied = applyFixes(set, parseVerdict(verdict));
      checked = applied.set;
      corrected = applied.applied;
    } catch {
      // The exam stands on its own.
    }

    return NextResponse.json({ ...checked, corrected });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json({ error: err.message || "generation failed" }, { status: 500 });
  }
}
