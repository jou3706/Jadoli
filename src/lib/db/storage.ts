"use client";

/**
 * File storage for materials and subject covers.
 *
 * Files dropped on a subject are uploaded to the Supabase `materials` bucket
 * (see supabase/02-subjects-and-storage.sql); the row in `materials` only keeps
 * the public URL. Local mode has nowhere to put a binary, so `canStoreFiles()`
 * is false there and the UI offers links only.
 */

import { getSupabase } from "./supabase-client";

// Defined in a module with no "use client" and re-exported for existing client
// imports. Server code must import from ./bucket directly: a value pulled out of
// a "use client" module arrives as a client-reference proxy, not the string.
import { BUCKET, MAX_FILE_BYTES } from "./bucket";
export { BUCKET, MAX_FILE_BYTES };

export const canStoreFiles = () => getSupabase() !== null;

export const ACCEPTED = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".ppt",
  ".pptx",
  ".key",
  ".odp",
  ".doc",
  ".docx",
  ".odt",
  ".rtf",
  ".txt",
  ".md",
  ".csv",
  ".xls",
  ".xlsx",
  ".zip",
].join(",");

/** Strips any path from the name and keeps only filename-safe characters. */
export function safeFileName(name: string): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  // "..." and "." are truthy but useless as a filename, so require a real stem.
  const hasStem = /\w/.test(cleaned.replace(/\./g, ""));
  const safe = hasStem ? cleaned : "file";
  // Keep the extension: kind detection and the open/download behaviour rely on it.
  return safe.length > 80 ? safe.slice(safe.length - 80) : safe;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** uid/<folder>/<timestamp>-<name> — the policies only allow the first segment. */
function objectPath(uid: string, folder: string, name: string): string {
  const stamp = Date.now().toString(36);
  return `${uid}/${folder}/${stamp}-${safeFileName(name)}`;
}

async function currentUserId(): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("NO_SUPABASE");
  // getSession reads the persisted session, so this costs no network call.
  const { data, error } = await sb.auth.getSession();
  const id = data.session?.user?.id;
  if (error || !id) throw new Error("NO_SESSION");
  return id;
}

async function upload(
  folder: string,
  name: string,
  body: Blob | ArrayBuffer,
  contentType: string,
): Promise<{ path: string; url: string }> {
  const sb = getSupabase();
  if (!sb) throw new Error("NO_SUPABASE");
  const uid = await currentUserId();
  const path = objectPath(uid, folder, name);

  const { error } = await sb.storage.from(BUCKET).upload(path, body, {
    contentType,
    upsert: false,
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);

  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

/** Uploads a file the user dropped and returns the path + public URL. */
export async function saveMaterialFile(file: File) {
  // Some Android WebViews hand the page a File backed by a content:// URI that
  // no fetch can stream: the upload then dies with a bare "Failed to fetch"
  // even though the network is fine and every other Supabase call works. Reading
  // the file to a buffer first gives the upload a concrete body to send.
  const body = await file.arrayBuffer();
  return upload("files", file.name, body, file.type || "application/octet-stream");
}

/** Stores a generated cover so it survives without bloating `subjects`. */
export function saveCoverImage(blob: Blob, name: string) {
  return upload("covers", `${name}.png`, blob, "image/png");
}

export async function removeStoredFile(path: string): Promise<void> {
  const sb = getSupabase();
  if (!sb || !path) return;
  const uid = await currentUserId();
  // Defence in depth: the policy blocks this, and so does this guard.
  if (!path.startsWith(`${uid}/`)) return;
  await sb.storage.from(BUCKET).remove([path]);
}
