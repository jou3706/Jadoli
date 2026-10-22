import { NextResponse } from "next/server";
import { chatBodySchema } from "@/lib/ai/schema";
import { streamChat } from "@/lib/ai/providers";
import { ASSISTANT_SYSTEM, MATERIALS_SYSTEM, QUIZ_CHAT_SYSTEM } from "@/lib/ai/prompts";
import { describePools, hasKeys, totalKeys } from "@/lib/ai/keys";
import { VIDEO_INSTRUCTION } from "@/lib/ai/video";
import type { ModelId } from "@/lib/ai/models";
import { guardAiRequest } from "@/lib/ai/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({
    configured: hasKeys(),
    totalKeys: totalKeys(),
    pools: describePools(),
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = chatBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  // After validation, so a malformed request costs nothing, and before any key is
  // touched, so an anonymous or over-quota caller never reaches a provider.
  const refused = await guardAiRequest(req, body);
  if (refused) return refused;

  const { model, question, mode, history, images, videos } = parsed.data;
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort(), { once: true });

  // The mode picks the instructions here on the server; the browser cannot
  // choose its own prompt.
  const system =
    mode === "quiz"
      ? QUIZ_CHAT_SYSTEM
      : mode === "materials"
        ? MATERIALS_SYSTEM
        : ASSISTANT_SYSTEM;

  // A video the student pasted is watched, not read: the model is told what it
  // is looking at, because a model asked about a recording without being told
  // will describe the video rather than what was said in it.
  const ask = videos.length ? `${question}\n\n${VIDEO_INSTRUCTION}` : question;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      const sendError = (message: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
      };

      try {
        const answer = await streamChat({
          model: model as ModelId,
          system,
          history: history.map((h) => ({ role: h.role, text: h.text })),
          question: ask,
          images: images.map((i) => ({ dataUrl: i.dataUrl, mime: i.mime })),
          videos: videos.map((v) => ({ uri: v.uri, mime: v.mime })),
          signal: ac.signal,
          onToken: (delta) => send({ token: delta }),
        });
        send({ done: true, answer });
      } catch (e) {
        const err = e as Error;
        if (err.message !== "ABORTED" && err.name !== "AbortError") {
          sendError(err.message);
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
