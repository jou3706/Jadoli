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
