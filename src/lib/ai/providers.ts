import "server-only";

import {
  candidates,
  clearPenalty,
  hasKeys,
  penalize,
  type KeyState,
} from "./keys";
import { fallbackChain, type ModelDef, type ModelId } from "./models";

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
 * Statuses that describe the request rather than the provider.
 *
 * Sending the same broken request to seventeen models would only produce
 * seventeen identical refusals, so these stop the walk. A 404 is deliberately
 * not here: that one is about the model, and the next model may well exist.
 */
const FATAL_STATUS = new Set([400, 413, 422]);

/** One call, on one key, with the model that was chosen for it. */
async function callProvider(
  def: ModelDef,
  key: KeyState,
  req: ChatRequest,
  abort: ReturnType<typeof linkAbort>,
): Promise<string> {
  return def.provider === "gemini"
    ? streamGemini(key, req, def.upstream, abort)
    : streamOpenAICompatible(
        key,
        req,
        def.upstream,
        def.provider === "groq" ? "api.groq.com/openai/v1" : "openrouter.ai/api/v1",
        def.provider === "openrouter"
          ? {
              "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "https://jadoli.app",
              "X-Title": "Jadoli",
            }
          : {},
        abort,
      );
}

/**
 * Streams a chat completion, walking models and keys until one succeeds.
 *
 * A failure penalises the key it burned — briefly for a rate limit, for hours
 * for an auth error — and the request moves on: the next key in that pool, then
 * the next model, then the next provider. Fifteen keys across three pools only
 * buy resilience if something actually walks between them.
 *
 * Once a token has reached the browser the answer is already on screen, so a
 * failure from that point is surfaced instead of restarted; a second attempt
 * would print the opening of the answer twice.
 */
export async function streamChat(req: ChatRequest): Promise<string> {
  const chain = fallbackChain(req.model, (req.images?.length ?? 0) > 0);
  if (!chain.some((m) => hasKeys(m.provider))) {
    throw new Error(
      `NO_KEYS:${chain[0].provider} — add ${chain[0].provider.toUpperCase()}_API_KEYS to .env.local`,
    );
  }

  const abort = linkAbort(req.signal);
  const errors: string[] = [];
  let emitted = false;
  const onToken = (t: string) => {
    if (t) emitted = true;
    req.onToken(t);
  };

  let attempted = false;
  for (const model of chain) {
    if (req.signal?.aborted) throw new Error("ABORTED");
    // A pool with no keys is not a failure worth reporting; walk past it.
    const pool = candidates(model.provider);
    if (!pool.length) continue;

    for (const key of pool) {
      attempted = true;
      if (req.signal?.aborted) throw new Error("ABORTED");
      try {
        const text = await callProvider(model, key, { ...req, onToken }, abort);
        clearPenalty(key);
        abort.done();
        return text;
      } catch (e) {
        const err = e as Error & { status?: number };
        if (err.name === "AbortError" || err.message === "ABORTED") throw e;
        if (emitted) {
          abort.done();
          throw Object.assign(new Error("STREAM_INTERRUPTED"), { status: err.status });
        }
        const cooled = penalize(key, `${err.status ?? ""} ${err.message}`);
        errors.push(
          `${model.provider}/${model.id}#${key.index} (${err.status ?? "?"}) → cooling ${Math.round(cooled / 1000)}s`,
        );
        if (err.status === 404) break; // that model is not there; try the next one
        if (err.status && FATAL_STATUS.has(err.status)) throw err;
      }
    }
  }
  abort.done();
  if (!attempted) throw new KeyExhaustedError(chain[0].provider);
  throw new Error(`every model failed — ${errors.join(" | ")}`);
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
