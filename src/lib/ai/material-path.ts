/**
 * The rules for deciding whether a stored material file may be read.
 *
 * Kept apart from the module that does the reading, and free of `server-only`,
 * for two reasons: the reading itself needs a request, a session and a network,
 * and none of that is what these rules are. They are a path check and a filename
 * check, and they are the part worth testing - a material id must not become a
 * way to read somebody else's file, and a path must not become a way to fetch
 * somewhere else on the network.
 *
 * `server-only` is deliberately absent. This file is imported by the route that
 * reads the file and by the tests that check the rules; nothing here touches
 * anything a browser must not see.
 */

/** The formats a model reads. Mirrors `READABLE_MIME` in lib/material-cards. */
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** `Lecture 3.pdf` -> `application/pdf`. Empty rather than a guess. */
export function mimeForName(name: string): string {
  const lower = (name ?? "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return "";
  return MIME_BY_EXT[lower.slice(dot + 1)] ?? "";
}

/**
 * Whether a stored path may be read on behalf of `userId`.
 *
 * A check on the shape of the path rather than a database round trip, so an
 * unguessable filename is not the only thing standing between two students. It
 * mirrors the upload policy in supabase/02-subjects-and-storage.sql: the first
 * segment is the owner's id, and nothing may climb out of it.
 */
export function isOwnPath(path: string, userId: string): boolean {
  const p = (path ?? "").trim().replace(/^\/+/, "");
  if (!p || !userId) return false;
  // Traversal, in both the plain and percent-encoded spellings.
  if (p.includes("..") || /%2e/i.test(p)) return false;
  if (p.includes("\\")) return false;
  // A prefix match here would let one account's id stand in for another's, so the
  // separator has to be part of the test rather than a string prefix.
  return p.startsWith(`${userId}/`);
}