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

/**
 * Enough to make cards from, and no more than a model will read.
 *
 * Either typed notes or a file, or both. The text is capped rather than the
 * images because a wall of pasted text is the failure that costs money without
 * producing cards, and the honest answer to it is "that is a lot of notes, save
 * it as a material and make cards from the lecture".
 */
export const MAX_NOTE_CHARS = 12_000;

/**
 * One file to read, named so the model can be told which question came from
 * which page.
 *
 * `dataUrl` rather than a URL: a URL handed to a model is not fetched, it is
 * quoted back at the student as a question about nothing. The browser reads the
 * material it already has access to and sends the bytes.
 */
export const materialPart = z.object({
  title: z.string().max(200).default(""),
  dataUrl: z
    .string()
    .regex(
      /^data:(image\/(png|jpeg|jpg|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/,
      { message: "attachment must be a base64 data URL" },
    )
    .max(30_000_000),
  mime: z.string().max(60),
});

/** Mirrors `MAX_CARDABLE_MATERIALS` in `lib/material-cards`. */
export const MAX_MATERIAL_PARTS = 6;

export const flashcardsBodySchema = z
  .object({
    model: z.string().min(1).max(60).default("gemini-35-flash"),
    /** The course these cards belong to. */
    subject: z.string().max(120).default(""),
    /** Notes typed or pasted by the student. */
    text: z.string().max(MAX_NOTE_CHARS).default(""),
    /** Files already saved as materials on the course. */
    materials: z.array(materialPart).max(MAX_MATERIAL_PARTS).default([]),
    /** How many cards to ask for. A hint, not a promise. */
    count: z.number().int().min(3).max(40).default(10),
    language: z.enum(["ar", "en"]).default("ar"),
  })
  .refine((v) => v.text.trim().length > 0 || v.materials.length > 0, {
    message: "there is nothing to make cards from",
    path: ["text"],
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
