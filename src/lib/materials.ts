/**
 * Material helpers, kept free of React so they can be unit tested.
 */

export type MaterialKindId =
  | "pdf"
  | "slides"
  | "doc"
  | "image"
  | "video"
  | "link";

export const MATERIAL_KINDS: {
  id: MaterialKindId;
  ar: string;
  en: string;
  /** Text + background classes for the badge. */
  tone: string;
}[] = [
  { id: "pdf", ar: "PDF", en: "PDF", tone: "text-rose-600 bg-rose-500/10" },
  { id: "slides", ar: "عرض", en: "Slides", tone: "text-amber-600 bg-amber-500/10" },
  { id: "doc", ar: "مستند", en: "Doc", tone: "text-sky-600 bg-sky-500/10" },
  { id: "image", ar: "صورة", en: "Image", tone: "text-emerald-600 bg-emerald-500/10" },
  { id: "video", ar: "فيديو", en: "Video", tone: "text-violet-600 bg-violet-500/10" },
  { id: "link", ar: "لينك", en: "Link", tone: "text-muted-foreground bg-muted" },
];

/** Picks the kind from the file extension or host, unless the user chose one. */
export function detectKind(url: string, type?: string | null): MaterialKindId {
  const chosen = MATERIAL_KINDS.find((k) => k.id === type);
  if (chosen) return chosen.id;

  const u = (url ?? "").trim().toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "video";
  if (u.includes("drive.google.com") || u.includes("docs.google.com"))
    return "link";
  if (/\.(pdf)(\?|#|$)/.test(u)) return "pdf";
  if (/\.(pptx?|key|odp)(\?|#|$)/.test(u)) return "slides";
  if (/\.(docx?|odt|rtf|txt|md)(\?|#|$)/.test(u)) return "doc";
  if (/\.(png|jpe?g|webp|gif|svg|avif)(\?|#|$)/.test(u)) return "image";
  return "link";
}

export function kindMeta(id: MaterialKindId) {
  return MATERIAL_KINDS.find((k) => k.id === id) ?? MATERIAL_KINDS[5];
}

/**
 * Only http(s) links may become an href — a stored `javascript:` URL would
 * otherwise run when the student clicks the row.
 */
export function safeUrl(raw: string | null | undefined): string {
  const u = (raw ?? "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) return "";
  try {
    // Rejects "https://" with no host.
    return new URL(u).href ? u : "";
  } catch {
    return "";
  }
}

/** Groups rows by course, biggest first, with untitled ones under "—". */
export function groupMaterials<T extends { subject_key: string }>(rows: T[]) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = (row.subject_key ?? "").trim() || "—";
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return [...map.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
}

/**
 * Materials the account already holds that this subject does not list yet, so
 * one can be reused instead of uploading the same file twice. Already-listed
 * titles are excluded because a duplicate name reads as a mistake on screen.
 */
export function reusableMaterials<T extends { title: string; subject_key: string }>(
  all: T[],
  subject: string,
  listed: T[],
): T[] {
  const seen = new Set(listed.map((m) => m.title.toLowerCase()));
  return all.filter(
    (m) => (m.subject_key ?? "").trim() !== subject && !seen.has(m.title.toLowerCase()),
  );
}

/**
 * How many rows point at each stored file. A material copied into another
 * subject shares the file, so deleting one of the two must not remove it and
 * leave the survivor holding a dead link.
 */
export function sharedFileCounts<T extends { file_path: string }>(all: T[]) {
  const counts = new Map<string, number>();
  for (const m of all) {
    if (m.file_path) counts.set(m.file_path, (counts.get(m.file_path) ?? 0) + 1);
  }
  return counts;
}
