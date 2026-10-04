export type ProviderId = "gemini" | "groq" | "openrouter";

export type ModelId =
  | "gemini-38-flash"
  | "gemini-37-flash"
  | "gemini-36-flash"
  | "gemini-35-flash"
  | "gemini-35-flash-lite"
  | "gemini-31-flash-lite"
  | "gemini-3-flash"
  | "groq-120b"
  | "groq-20b"
  | "groq-qwen"
  | "or-free"
  | "or-nemotron-ultra"
  | "or-nemotron-super"
  | "or-qwen27"
  | "or-gemma31"
  | "or-gemma26"
  | "or-nemotron-light"
  | "or-omni";

export type ModelDef = {
  id: ModelId;
  provider: ProviderId;
  label: string;
  /** Upstream model identifier. */
  upstream: string;
  supportsImages: boolean;
  /** Gemini reads PDFs natively; the OpenAI-compatible pools are image only. */
  supportsPdf?: boolean;
};

export const MODELS: ModelDef[] = [
  // Google — best first
  { id: "gemini-38-flash", provider: "gemini", label: "Gemini 3.8 Flash", upstream: "gemini-3.5-flash", supportsImages: true, supportsPdf: true },
  { id: "gemini-37-flash", provider: "gemini", label: "Gemini 3.7 Flash", upstream: "gemini-3.8-flash", supportsImages: true, supportsPdf: true },
  { id: "gemini-36-flash", provider: "gemini", label: "Gemini 3.6 Flash", upstream: "gemini-3.6-flash", supportsImages: true, supportsPdf: true },
  { id: "gemini-35-flash", provider: "gemini", label: "Gemini 3.5 Flash ★", upstream: "gemini-3.5-flash-lite", supportsImages: true, supportsPdf: true },
  { id: "gemini-35-flash-lite", provider: "gemini", label: "Gemini 3.5 Flash-Lite", upstream: "gemini-3.5-flash-lite", supportsImages: true, supportsPdf: true },
  { id: "gemini-31-flash-lite", provider: "gemini", label: "Gemini 3.1 Flash-Lite", upstream: "gemini-3.1-flash-lite", supportsImages: true, supportsPdf: true },
  { id: "gemini-3-flash", provider: "gemini", label: "Gemini 3 Flash (preview)", upstream: "gemini-3-flash-preview", supportsImages: true, supportsPdf: true },
  // Groq
  { id: "groq-120b", provider: "groq", label: "GPT-OSS 120B ★", upstream: "openai/gpt-oss-120b", supportsImages: false },
  { id: "groq-20b", provider: "groq", label: "GPT-OSS 20B", upstream: "openai/gpt-oss-20b", supportsImages: false },
  { id: "groq-qwen", provider: "groq", label: "Qwen 3.8 27B", upstream: "qwen/qwen3.8-27b", supportsImages: false },
  // OpenRouter (free tier)
  { id: "or-free", provider: "openrouter", label: "Free Router (auto) ★", upstream: "openrouter/free", supportsImages: false },
  { id: "or-nemotron-ultra", provider: "openrouter", label: "Nemotron 3 Ultra 550B", upstream: "nvidia/nemotron-3-ultra-550b-a55b:free", supportsImages: false },
  { id: "or-nemotron-super", provider: "openrouter", label: "Nemotron 3 Super 120B", upstream: "nvidia/nemotron-3-super-120b-a12b:free", supportsImages: false },
  { id: "or-qwen27", provider: "openrouter", label: "Qwen 3.8 27B", upstream: "qwen/qwen3.8-27b:free", supportsImages: false },
  { id: "or-gemma31", provider: "openrouter", label: "Gemma 4 31B", upstream: "google/gemma-4-31b-it:free", supportsImages: false },
  { id: "or-gemma26", provider: "openrouter", label: "Gemma 4 26B", upstream: "google/gemma-4-26b-a4b-it:free", supportsImages: false },
  { id: "or-nemotron-light", provider: "openrouter", label: "Nemotron 3.5 Lightning", upstream: "nvidia/nemotron-3.5-lightning:free", supportsImages: false },
  { id: "or-omni", provider: "openrouter", label: "Nemotron 3 Nano Omni 30B", upstream: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", supportsImages: false },
];

export const MODEL_IDS = MODELS.map((m) => m.id);

export const DEFAULT_MODEL: ModelId = "gemini-35-flash";

export const findModel = (id: string): ModelDef =>
  MODELS.find((m) => m.id === id) ?? MODELS[0];

/** Whether a model can be handed a picture or a PDF at all. */
export const readsAttachments = (m: ModelDef) => m.supportsImages || m.supportsPdf === true;

/** The order providers are offered in. Gemini reads attachments; the rest are text. */
export const PROVIDER_ORDER: ProviderId[] = ["gemini", "groq", "openrouter"];

/**
 * Who answers next, per provider, best first.
 *
 * Within a pool the models overlap a lot, so a rate limit on one is usually a
 * temporary problem and a sibling is enough. The list is also what makes the
 * app survive a whole provider being unavailable, which is the only real
 * difference between fifteen keys spread over three pools and fifteen keys in
 * one.
 */
const PROVIDER_FALLBACK: Record<ProviderId, ModelId[]> = {
  gemini: ["gemini-38-flash", "gemini-35-flash-lite", "gemini-3-flash"],
  groq: ["groq-120b", "groq-20b", "groq-qwen"],
  openrouter: ["or-free", "or-qwen27", "or-nemotron-super"],
};

/**
 * The models to try, in order, for one request.
 *
 * The chosen model is always first - a person who picked a model meant it. The
 * rest is insurance: another model in the same pool first, because that shares
 * the key pool and the shape of the answer, then the other pools.
 *
 * A request carrying a picture or a PDF only ever sees models that can read
 * one. Handing an image to a text-only model wastes the whole call, so those are
 * filtered out rather than tried and failed.
 */
export function fallbackChain(start: ModelId | ModelDef, hasAttachments: boolean): ModelDef[] {
  const first = typeof start === "string" ? findModel(start) : start;
  const seen = new Set<string>();
  const chain: ModelDef[] = [];
  const offer = (id: ModelId) => {
    const m = findModel(id);
    if (seen.has(m.id)) return;
    if (hasAttachments && !readsAttachments(m)) return;
    seen.add(m.id);
    chain.push(m);
  };

  offer(first.id);
  for (const id of PROVIDER_FALLBACK[first.provider]) offer(id);
  for (const provider of PROVIDER_ORDER) {
    for (const id of PROVIDER_FALLBACK[provider]) offer(id);
  }
  return chain;
}
