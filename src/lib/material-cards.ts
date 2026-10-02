/**
 * Which materials can become cards, and why the others cannot.
 *
 * A `Material` row is a title and a URL. That is enough for the app to show a
 * list and open a link, and it is not enough to write questions from. Only a
 * file the student actually uploaded arrives as bytes the model can read; a
 * YouTube link, a Drive link or a web page arrives as a string of characters
 * that no model will open on its own.
 *
 * So the rule here is deliberately narrow. Handing a URL to a model and letting
 * it guess produces confident, well-formatted, invented questions - which is the
 * one failure this app cannot have, because a wrong flashcard is not obviously
 * wrong to the student who is being asked it next week.
 *
 * Everything here is pure so the rule can be tested without a browser, a bucket,
 * or a key.
 */

import { detectKind, safeUrl, type MaterialKindId } from "./materials";

/** The bits of a `Material` this module needs. */
export type MaterialRef = {
  id: string;
  title: string;
  url: string;
  type?: string | null;
  /** Set only when the student uploaded a file; empty for a saved link. */
  file_path: string;
  size: number;
};

export type CardableReason =
  /** The file is stored and is a format a model can read. */
  | "ready"
  /** A saved link, not an uploaded file. */
  | "link"
  /** A video. There is no transcript here to ask questions about. */
  | "video"
  /** PowerPoint/Keynote. The bytes are a zip, not text. */
  | "slides"
  /** Word/ODF. Same problem as slides, and the common case. */
  | "doc"
  /** Uploaded, but too big to hand to a model. */
  | "too-big"
  /** Uploaded, but the app has no row pointing at the bytes any more. */
  | "missing-file"
  /** Not a URL the app is willing to fetch or store. */
  | "bad-url";

export type Cardable<T extends MaterialRef = MaterialRef> = {
  material: T;
  kind: MaterialKindId;
  reason: CardableReason;
  /** `application/pdf` or `image/*`, when the material is readable. */
  mime: string;
  ok: boolean;
};

/**
 * Kinds a model reads directly. Gemini takes a PDF or a picture of a page; the
 * OpenAI-compatible pools take pictures only, and nothing takes a zip.
 */
const READABLE_MIME: Partial<Record<MaterialKindId, string>> = {
  pdf: "application/pdf",
  image: "image/png",
};

const EXT_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * A model will read a page as an image, so a picture of a slide is fair game -
 * but only if it is one of the formats the request schema accepts. `gif` and
 * `svg` are not.
 */
function mimeFromName(name: string): string {
  const lower = (name ?? "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return "";
  return EXT_MIME[lower.slice(dot)] ?? "";
}

/**
 * A model reads a few megabytes of a PDF before it starts guessing, so an
 * oversized lecture file produces cards that are about the wrong lecture. 12 MB
 * is the point where that trade stops being worth it, and it is below the 25 MB
 * the uploader allows, which means a file can still be saved as a material and
 * only be too big to generate from.
 */
export const MAX_CARDABLE_BYTES = 12 * 1024 * 1024;

/** How many materials one generation may read. Six is already a lot of context. */
export const MAX_CARDABLE_MATERIALS = 6;

/** Decides whether one material can be read, and names the reason if not. */
export function cardableMaterial<T extends MaterialRef>(material: T): Cardable<T> {
  const kind = detectKind(material.url ?? "", material.type);
  const uploaded = Boolean((material.file_path ?? "").trim());
  const mime = mimeFromName(material.title) || mimeFromName(material.url) || "";

  const blocked = (reason: CardableReason): Cardable<T> => ({
    material,
    kind,
    reason,
    mime: "",
    ok: false,
  });

  if (!uploaded) {
    // A link is the common case, and the distinction that matters is *why* it
    // cannot be read: a video and a web page fail for different reasons and the
    // student can act on only one of them.
    if (kind === "video") return blocked("video");
    if (kind === "slides") return blocked("slides");
    if (kind === "doc") return blocked("doc");
    if (!safeUrl(material.url)) return blocked("bad-url");
    return blocked("link");
  }

  const wanted = READABLE_MIME[kind];
  if (!wanted) return blocked(kind === "slides" ? "slides" : kind === "doc" ? "doc" : "link");
  // An uploaded `.gif` or `.svg` is a real file the app accepted on the way in,
  // and still not something a model will read as a page.
  if (!mime || !Object.values(EXT_MIME).includes(mime)) return blocked("link");
  if (material.size > MAX_CARDABLE_BYTES) return blocked("too-big");

  return { material, kind, reason: "ready", mime, ok: true };
}

/** The same decision for a list, in the order it was given. */
export function cardableMaterials<T extends MaterialRef>(rows: T[]): Cardable<T>[] {
  return rows.map(cardableMaterial);
}

/** Just the ones worth offering on the button. */
export function readableMaterials<T extends MaterialRef>(rows: T[]): T[] {
  return cardableMaterials(rows)
    .filter((c) => c.ok)
    .map((c) => c.material);
}

/**
 * Keeps a pick inside what one request can carry.
 *
 * The first `MAX_CARDABLE_MATERIALS` readable rows win, in the order they were
 * ticked, so the cap never silently swaps in a file the student did not choose.
 */
export function capSelection<T extends MaterialRef>(picked: T[]): {
  kept: T[];
  over: number;
} {
  const kept = picked.slice(0, MAX_CARDABLE_MATERIALS);
  return { kept, over: Math.max(0, picked.length - kept.length) };
}

/**
 * What a blocked material cannot be read as, in the app's two languages.
 *
 * Written as an action where there is one. "Not supported" tells a student
 * nothing they can do; "save it as a file first" tells them exactly what to
 * press.
 */
export function blockedLabel(
  reason: CardableReason,
  lang: "ar" | "en",
): string {
  const table: Record<Exclude<CardableReason, "ready">, [string, string]> = {
    link: [
      "لينك — نزّله كملف وارفعه عشان نعمل منه كروت",
      "a link — download it and upload the file to make cards",
    ],
    video: [
      "فيديو — مفيش نص محفوظ منه",
      "a video — there is no saved transcript of it",
    ],
    slides: [
      "عرض تقديمي — مش مدعوم،صدّره PDF",
      "slides — not supported, export it as a PDF",
    ],
    doc: [
      "مستند — مش مدعوم,صدّره PDF",
      "a document — not supported, export it as a PDF",
    ],
    "too-big": [
      "الملف كبير على التوليد",
      "too big to generate from",
    ],
    "missing-file": ["الملف مش موجود", "the file is missing"],
    "bad-url": ["اللينك مش صالح", "that link is not usable"],
  };
  const found = table[reason as Exclude<CardableReason, "ready">];
  if (!found) return lang === "en" ? "not supported" : "مش مدعوم";
  return lang === "en" ? found[1] : found[0];
}

/**
 * The label stored on a card's `source`, so a wrong card can be traced to the
 * file it came from. One file keeps its own name; several become a count.
 */
export function cardSourceLabel(picked: MaterialRef[], lang: "ar" | "en"): string {
  const name = (m: MaterialRef) => (m.title ?? "").trim() || "material";
  if (!picked.length) return "";
  if (picked.length === 1) return name(picked[0]).slice(0, 200);
  const first = name(picked[0]);
  const rest = picked.length - 1;
  return (
    lang === "en"
      ? `${first} +${rest} more`
      : `${first} +${rest} كمان`
  ).slice(0, 200);
}