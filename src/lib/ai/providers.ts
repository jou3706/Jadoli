import "server-only";

import {
  candidates,
  clearPenalty,
  hasKeys,
  penalize,
  type KeyState,
} from "./keys";
import { findModel, type ModelId } from "./models";

export type ChatTurn = { role: "user" | "assistant"; text: string };
export type ImagePart = { dataUrl: string; mime: string };

export type ChatRequest = {
  model: ModelId;
  system: string;
  history: ChatTurn[];
  question: string;
  images?: ImagePart[];
  signal?: AbortSignal;
  /** Ask the provider to emit only syntactically valid JSON. */
  json?: boolean;
  onToken: (delta: string) => void;
};

const IDLE_TIMEOUT_MS = 90_000;

/**
 * SSE frame separator. Gemini sends `\r\n\r\n`, OpenAI-compatible APIs send
 * `\n\n` — splitting on the literal `\n\n` silently drops every Gemini token.
 */
const FRAME_SPLIT = /\r?\n\r?\n/;
const LINE_SPLIT = /\r?\n/;

const linkAbort = (outer?: AbortSignal) => {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort(outer?.reason ?? new Error("ABORTED"));
  outer?.addEventListener("abort", onAbort, { once: true });
  let timer = setTimeout(
    () => ctl.abort(new Error("IDLE_TIMEOUT")),
    IDLE_TIMEOUT_MS,
  );
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctl.abort(new Error("IDLE_TIMEOUT")), IDLE_TIMEOUT_MS);
  };
  return { signal: ctl.signal, reset, done: () => clearTimeout(timer) };
};

class KeyExhaustedError extends Error {
  constructor(provider: string) {
    super(`No working keys left for ${provider}`);
    this.name = "KeyExhaustedError";
  }
}

/* ── Gemini ────────────────────────────────────────────────── */

async function streamGemini(
  key: KeyState,
  req: ChatRequest,
  model: string,
  abort: ReturnType<typeof linkAbort>,
) {
  const parts: string[] = [];
  const conversation = [
    ...req.history.map((t) => ({
      role: t.role === "assistant" ? "model" : "user",
      parts: [{ text: t.text }],
    })),
    {
      role: "user",
      parts: [
        { text: req.question },
        ...(req.images ?? []).map((img) => ({
          inline_data: { mime_type: img.mime, data: img.dataUrl.split(",")[1] ?? "" },
        })),
      ],
    },
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${key.key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: conversation,
        generationConfig: {
          temperature: 0.3,
          // Constrains the model to valid JSON, which is the difference between
          // an exam and "Unexpected token" when it forgets a quote.
          ...(req.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
      signal: abort.signal,
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`), {
      status: res.status,
    });
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    abort.reset();
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split(FRAME_SPLIT);
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      for (const line of frame.split(LINE_SPLIT)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const chunks =
            json?.candidates?.[0]?.content?.parts ?? json?.candidates?.[0]?.text;
          const texts: string[] = Array.isArray(chunks)
            ? chunks.map((c: { text?: string }) => c?.text ?? "")
            : [chunks ?? ""];
          for (const t of texts) {
            if (t) {
              parts.push(t);
              req.onToken(t);
            }
          }
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  }
  if (buf.trim()) {
    const payload = buf.trim().replace(/^data:\s*/, "");
    if (payload && payload !== "[DONE]") {
      try {
        const texts =
          JSON.parse(payload)?.candidates?.[0]?.content?.parts ?? [];
        for (const c of Array.isArray(texts) ? texts : []) {
          if (c?.text) {
            parts.push(c.text);
            req.onToken(c.text);
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  return parts.join("");
}

/* ── OpenAI-compatible (Groq + OpenRouter) ─────────────────── */

async function streamOpenAICompatible(
  key: KeyState,
  req: ChatRequest,
  model: string,
  host: string,
  extraHeaders: Record<string, string>,
  abort: ReturnType<typeof linkAbort>,
) {
  const userContent: unknown[] = [{ type: "text", text: req.question }];
  for (const img of req.images ?? []) {
    if (!img.mime.startsWith("image/")) continue;
    userContent.push({ type: "image_url", image_url: { url: img.dataUrl } });
  }

  const res = await fetch(`https://${host}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key.key}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: 0.3,
      // Groq honours JSON mode; OpenRouter forwards it to models that may not
      // support it, so there it is left to the prompt.
      ...(req.json && host.includes("groq") ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: req.system },
        ...req.history.map((t) => ({ role: t.role, content: t.text })),
        {
          role: "user",
          content: userContent.length === 1 ? req.question : userContent,
        },
      ],
    }),
    signal: abort.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`${host} ${res.status}: ${text.slice(0, 200)}`),
      { status: res.status },
    );
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let out = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    abort.reset();
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split(FRAME_SPLIT);
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      for (const line of frame.split(LINE_SPLIT)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            out += delta;
            req.onToken(delta);
          }
        } catch {
          /* ignore */
        }
      }
    }
  }
  return out;
}

/* ── Orchestrator ──────────────────────────────────────────── */

/**
 * Streams a chat completion, walking the key pool until one succeeds. Each
 * failure penalises that key (short cooldown for rate limits, long for auth
 * errors) and the request transparently retries on the next healthy key.
 */
export async function streamChat(req: ChatRequest): Promise<string> {
  const def = findModel(req.model);
  if (!hasKeys(def.provider)) {
    throw new Error(
      `NO_KEYS:${def.provider} — add ${def.provider.toUpperCase()}_API_KEYS to .env.local`,
    );
  }

  const pool = candidates(def.provider);
  if (!pool.length) throw new KeyExhaustedError(def.provider);

  const abort = linkAbort(req.signal);
  const errors: string[] = [];
  let emitted = false;
  const onToken = (t: string) => {
    if (t) emitted = true;
    req.onToken(t);
  };

  for (let attempt = 0; attempt < pool.length; attempt++) {
    const key = pool[attempt];
    if (req.signal?.aborted) throw new Error("ABORTED");
    try {
      const text =
        def.provider === "gemini"
          ? await streamGemini(key, { ...req, onToken }, def.upstream, abort)
          : await streamOpenAICompatible(
              key,
              { ...req, onToken },
              def.upstream,
              def.provider === "groq" ? "api.groq.com/openai/v1" : "openrouter.ai/api/v1",
              def.provider === "openrouter"
                ? {
                    "HTTP-Referer":
                      process.env.NEXT_PUBLIC_SITE_URL ?? "https://jadoli.app",
                    "X-Title": "Jadoli",
                  }
                : {},
              abort,
            );
      clearPenalty(key);
      abort.done();
      return text;
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.name === "AbortError" || err.message === "ABORTED") throw e;
      // Part of the answer already reached the browser — restarting on another
      // key would duplicate text, so surface the failure instead.
      if (emitted) {
        abort.done();
        throw Object.assign(new Error("STREAM_INTERRUPTED"), { status: err.status });
      }
      const cooled = penalize(key, `${err.status ?? ""} ${err.message}`);
      errors.push(
        `${def.provider}#${key.index} (${err.status ?? "?"}) → cooling ${Math.round(cooled / 1000)}s`,
      );
      if (err.status && err.status < 500 && err.status !== 429) {
        // Client-side problem — trying a different key won't help.
        throw err;
      }
    }
  }
  abort.done();
  throw new Error(`All ${def.provider} keys failed — ${errors.join(" | ")}`);
}

/* ── Non-streaming helper for structured tasks ─────────────── */

export async function completeJson(
  modelId: ModelId,
  system: string,
  user: string,
  images?: ImagePart[],
  signal?: AbortSignal,
  /**
   * Ask the provider to constrain the reply to JSON. Only for callers that want
   * a JSON *object*: OpenAI/Groq's JSON mode cannot return a bare array, so the
   * list-returning callers leave it off and rely on the prompt and the extractor.
   */
  json = false,
): Promise<string> {
  let out = "";
  await streamChat({
    model: modelId,
    system,
    history: [],
    question: user,
    images,
    signal,
    json,
    onToken: (t) => {
      out += t;
    },
  });
  return out;
}
