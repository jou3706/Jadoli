/**
 * Reading a database refusal.
 *
 * Two failures look the same to a student — "you already added this" and
 * something went wrong — but they are not the same to handle, and the server
 * says which it is in the least convenient way: a Postgres code on the error
 * and the same fact again in a message, on an object that may or may not be an
 * `Error` depending on which layer threw it.
 *
 * So this looks at both, and it looks at the message as a string rather than
 * assuming it can be. A helper that only works when handed a real `Error` fails
 * silently on the path that matters most.
 */
export type DbError = { code?: unknown; message?: unknown };

const asText = (err: unknown) => {
  const e = (err ?? {}) as DbError;
  const parts = [e.code, e.message];
  if (!parts.some((p) => typeof p === "string")) return String(err ?? "");
  return parts.filter((p) => typeof p === "string").join(" ");
};

/** Whether the row was refused for breaking a unique index. */
export const isUniqueViolation = (err: unknown) =>
  /duplicate key|23505|already exists|conflict/i.test(asText(err));