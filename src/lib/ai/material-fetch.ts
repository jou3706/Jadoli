import "server-only";

/**
 * Reading a student's own material file, server side.
 *
 * The reason this exists: the deployment refuses a request body over 4.5 MB, and
 * base64 grows a file by a third, so a lecture PDF sent up from the browser is
 * turned away by the platform before any model is reached. The failure arrives as
 * a plain-text 413 rather than the JSON the app expects, which is why it showed up
 * as a bare "Could not make the cards" with no explanation.
 *
 * So the browser sends a reference and this module does the reading.
 *
 * Two rules make that safe:
 *
 *  1. The URL is built here, from the project's own storage host. A path that
 *     does not sit under that host is never fetched, so this cannot be turned
 *     into a request to somewhere else on the network.
 *  2. The path has to start with the caller's own user id - the same rule the
 *     upload policy enforces - so one student cannot read another's file by
 *     guessing a name.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { BUCKET } from "@/lib/db/storage";
import {
  encodeStoragePath,
  isOwnPath,
  mimeForName,
} from "./material-path";

/** The one table this module reads. Named here rather than imported from the
 * client writer, because that module is browser-side by design. */
const MATERIALS_TABLE = "materials";

/** The untyped client, matching how src/lib/db/supabase-client.ts builds one. */
type Sb = SupabaseClient;

/** The two columns read out of a material row. */
type Row = { file_path: string | null; title: string | null };

/**
 * Read past this and Gemini starts answering about the first pages only, which
 * is worse than refusing: the student gets real cards from the wrong lecture.
 *
 * Kept in step with `MAX_CARDABLE_BYTES` in lib/material-cards, which is the
 * friendlier version of the same limit and greys the file out instead.
 */
export const MAX_READ_BYTES = 10 * 1024 * 1024;

/** How long a single download may take before the whole thing gives up. */
const FETCH_TIMEOUT_MS = 30_000;

export type LoadedMaterial = {
  title: string;
  dataUrl: string;
  mime: string;
};

export type Loaded = {
  materials: LoadedMaterial[];
  /** Materials that were asked for but could not be read, with the reason. */
  skipped: { id: string; title: string; reason: string }[];
};

function storageBase(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NO_BACKEND");
  return `${url.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}/`;
}

/**
 * A Supabase client bound to the caller, able only to read their own rows.
 *
 * The anon key plus the caller's own token: RLS still applies, so this can only
 * ever confirm who is asking. It is never a service key.
 */
function clientFor(token: string): Sb {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NO_BACKEND");
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The bearer token on the request, or empty. */
const bearer = (req: Request) =>
  (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

/** Confirms who is asking, using their own token. */
async function currentUserId(sb: Sb, token: string) {
  if (!token) throw new Error("NO_SESSION");
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user?.id) throw new Error("NO_SESSION");
  return data.user.id;
}

/**
 * Confirms the material belongs to the caller, and returns the path as stored.
 *
 * The client's own `file_path` is treated as a hint. The row is the answer, so a
 * material id cannot be paired with someone else's path to make the fetch below
 * read it.
 */
async function ownedPath(
  sb: Sb,
  id: string,
  userId: string,
): Promise<{ path: string; title: string } | null> {
  const { data, error } = await sb
    .from(MATERIALS_TABLE)
    .select("file_path,title")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Row;
  const path = String(row.file_path ?? "").trim();
  if (!path || !isOwnPath(path, userId)) return null;
  return { path, title: String(row.title ?? "") };
}

/** Streams a URL into a base64 data URL, refusing to buffer past the cap. */
async function toDataUrl(
  url: string,
  mime: string,
  signal: AbortSignal,
): Promise<{ dataUrl: string } | { error: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("TIMEOUT")), FETCH_TIMEOUT_MS);
  const onAbort = () => ac.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return { error: `READ_FAILED_${res.status}` };

    // The declared length is a hint and is often missing; the count below is what
    // actually stops the download.
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_READ_BYTES) return { error: "TOO_BIG" };

    if (!res.body) return { error: "NO_BODY" };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_READ_BYTES) {
        await reader.cancel().catch(() => {});
        return { error: "TOO_BIG" };
      }
      chunks.push(value);
    }
    if (!total) return { error: "EMPTY_FILE" };

    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      // Chunked, because spreading a multi-megabyte array into apply() blows the
      // call stack.
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { dataUrl: `data:${mime};base64,${btoa(bin)}` };
  } catch (e) {
    const err = e as Error & { name?: string };
    if (err.name === "AbortError") return { error: "TIMEOUT" };
    return { error: "READ_FAILED" };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Reads every requested material that belongs to the caller.
 *
 * A file that cannot be read is reported rather than dropped, because "I made you
 * twelve cards from three of your five files" is a claim the student has to be
 * able to check.
 */
export async function loadMaterials(
  req: Request,
  refs: { id: string; title: string }[],
  signal: AbortSignal,
): Promise<Loaded> {
  const materials: LoadedMaterial[] = [];
  const skipped: Loaded["skipped"] = [];

  let sb: Sb;
  let userId: string;
  try {
    sb = clientFor(bearer(req));
    userId = await currentUserId(sb, bearer(req));
  } catch (e) {
    const err = (e as Error).message;
    return {
      materials: [],
      skipped: refs.map((r) => ({
        id: r.id,
        title: r.title,
        reason: err === "NO_BACKEND" ? "NO_BACKEND" : "NO_SESSION",
      })),
    };
  }

  const base = storageBase();

  for (const ref of refs) {
    const owned = await ownedPath(sb, ref.id, userId);
    if (!owned) {
      skipped.push({ id: ref.id, title: ref.title, reason: "NOT_YOURS" });
      continue;
    }
    const mime = mimeForName(owned.path) || mimeForName(owned.title);
    if (!mime) {
      skipped.push({ id: ref.id, title: owned.title, reason: "UNSUPPORTED_TYPE" });
      continue;
    }
    // Built from our own host and a path already proven to be the caller's, so
    // this cannot fetch an arbitrary address.
    const out = await toDataUrl(base + encodeStoragePath(owned.path), mime, signal);
    if ("error" in out) {
      skipped.push({ id: ref.id, title: owned.title, reason: out.error });
      continue;
    }
    materials.push({ title: owned.title, dataUrl: out.dataUrl, mime });
  }

  return { materials, skipped };
}

/** A reason in the app's two languages, for the dialog to show. */
export function skipReason(reason: string, lang: "ar" | "en"): string {
  const table: Record<string, [string, string]> = {
    NO_SESSION: ["لازم تسجل دخول تاني", "sign in again"],
    NO_BACKEND: ["مش متوصل بالداتابيز", "not connected to the database"],
    NOT_YOURS: ["الملف مش موجود", "that file is not there"],
    UNSUPPORTED_TYPE: ["صيغة مش مدعومة", "that format is not supported"],
    TOO_BIG: ["الملف كبير على القراءة", "that file is too big to read"],
    EMPTY_FILE: ["الملف فاضي", "that file is empty"],
    TIMEOUT: ["القراءة اتأخرت", "that file took too long to read"],
    READ_FAILED: ["مش قادرين نقرأ الملف", "could not read that file"],
    READ_FAILED_404: ["الملف مش موجود", "that file is not there"],
  };
  const found = table[reason] ?? table.READ_FAILED;
  return lang === "en" ? found[1] : found[0];
}