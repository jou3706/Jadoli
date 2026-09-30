import { z } from "zod";

const turn = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(20_000),
});

const image = z.object({
  dataUrl: z
    .string()
    .regex(/^data:(image\/(png|jpe?g|webp|gif)|application\/pdf);base64,[A-Za-z0-9+/=]+$/, {
      message: "attachment must be a base64 data URL",
    })
    .max(20_000_000),
  mime: z.string().max(60),
});

/** True when the provider/model can actually read this attachment. */
export const attachmentKind = (mime: string) =>
  mime === "application/pdf" ? "pdf" : "image";

/** Which slice of the student's data the assistant is allowed to use. */
export const ASSISTANT_MODES = ["general", "materials"] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];

export const chatBodySchema = z.object({
  model: z.string().min(1).max(60),
  question: z.string().min(1).max(8000),
  mode: z.enum(ASSISTANT_MODES).default("general"),
  history: z.array(turn).max(40).default([]),
  images: z.array(image).max(6).default([]),
});

export const importBodySchema = z.object({
  model: z.string().min(1).max(60).default("gemini-35-flash"),
  images: z.array(image).min(1).max(8),
});

/** Strips a leading ```action ...``` block out of a reply. */
export function splitAction(reply: string): {
  visible: string;
  actions: unknown[];
} {
  const re = /```action\s*\n([\s\S]*?)```/g;
  const actions: unknown[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) actions.push(...parsed);
      else actions.push(parsed);
    } catch {
      /* skip malformed action */
    }
  }
  const visible = reply
    .replace(/```action\s*\n[\s\S]*?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { visible, actions: actions.filter((a) => a && typeof a === "object") };
}
