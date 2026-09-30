import "server-only";

import { NextResponse } from "next/server";
import { candidates, clearPenalty, penalize } from "@/lib/ai/keys";
import { buildCoverPrompt } from "@/lib/ai/prompts";

export const runtime = "nodejs";

/**
 * Generates one cover image for a subject.
 *
 * Gemini's image models are non-streaming, so this is a plain call with the
 * usual key rotation/cooldown. It returns the raw image as a data URL; the
 * client downscales it and uploads it to Storage, which keeps the service role
 * key out of the upload path (Storage RLS decides who may write).
 */

/** Fast/cheap first, then the better model. All three are real model ids. */
const IMAGE_MODELS = [
  "gemini-3.1-flash-image",
  "gemini-2.5-flash-image",
  "gemini-3-pro-image",
];

/** Free-tier image quota is per project, so a 429 will not fix itself by
 *  trying the next model — stop instead of firing 20 doomed requests. */
const QUOTA = /429|RESOURCE_EXHAUSTED|quota|billing|exceeded/i;

type GeminiPart = { inlineData?: { mimeType?: string; data?: string }; text?: string };
type GeminiReply = {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};

function firstImage(reply: GeminiReply): { mime: string; data: string } | null {
  for (const cand of reply.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return {
          mime: part.inlineData.mimeType || "image/png",
          data: part.inlineData.data,
        };
      }
    }
  }
  return null;
}

export async function POST(req: Request) {
  let subject = "";
  try {
    const body = (await req.json()) as { subject?: unknown };
    subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 120) : "";
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!subject) {
    return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  }

  const keys = candidates("gemini");
  if (keys.length === 0) {
    return NextResponse.json({ error: "No Gemini key configured" }, { status: 503 });
  }

  const prompt = buildCoverPrompt(subject);
  const failures: string[] = [];
  let quota = false;
  let last = "generation failed";

  // Model first, then key: a model that does not exist should not burn keys.
  for (const model of IMAGE_MODELS) {
    for (const key of keys) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key.key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { responseModalities: ["IMAGE"] },
            }),
            signal: AbortSignal.timeout(75_000),
          },
        );

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          last = `${model} ${res.status}: ${text.slice(0, 160)}`;
          if (QUOTA.test(last)) quota = true;
          penalize(key, last);
          continue;
        }

        const reply = (await res.json()) as GeminiReply;
        const image = firstImage(reply);
        if (!image) {
          const blocked = reply.promptFeedback?.blockReason ?? reply.candidates?.[0]?.finishReason;
          last = blocked ? `${model} blocked: ${blocked}` : `${model} returned no image`;
          failures.push(last);
          penalize(key, last);
          continue;
        }

        clearPenalty(key);
        return NextResponse.json({
          image: `data:${image.mime};base64,${image.data}`,
          model,
        });
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
        failures.push(last);
        penalize(key, last);
      }
    }
    // A quota wall is not a model problem — stop instead of asking every model.
    if (quota) break;
  }

  return NextResponse.json(
    {
      error: quota
        ? "IMAGE_QUOTA"
        : failures.at(-1) ?? last,
      detail: failures.slice(0, 3),
    },
    { status: quota ? 429 : 502 },
  );
}
