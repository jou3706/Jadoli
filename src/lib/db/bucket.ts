/**
 * Where uploaded files live.
 *
 * Kept in its own module with no "use client" so that both the browser writer and
 * the server-side reader can import it.
 *
 * It used to live in db/storage.ts, which is a "use client" module. Importing a
 * value from a client module into server code does not hand the server the value:
 * the bundler substitutes a client-reference proxy, so a constant read as
 * `storage.from(BUCKET)` named no bucket at all and Supabase answered
 * "NoSuchBucket". The failure looked like a missing file, because that is the
 * status a bad bucket name returns.
 */
export const BUCKET = "materials";

/**
 * The largest upload the app accepts.
 *
 * Larger than the read cap in lib/ai/material-fetch on purpose: a student should
 * be able to keep a file they cannot make cards from, rather than have the upload
 * refused.
 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;