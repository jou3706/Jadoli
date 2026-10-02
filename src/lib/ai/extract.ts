/**
 * Pulling JSON out of a model's reply.
 *
 * A model asked for JSON usually gives JSON, and in the remaining cases it gives
 * JSON inside a fence, or JSON after a sentence explaining what it is about to
 * do, or JSON with one trailing comma. Rather than trust the format, this finds
 * the first balanced array or object in the text and reads that — and returns
 * nothing rather than throwing when there is no such thing, because "the model
 * answered with prose" is a normal outcome to handle, not an exception to
 * propagate.
 *
 * Brace counting that understands strings and escapes, because a brace inside a
 * quoted answer is not the end of the object.
 */

const OPEN = { "[": "]", "{": "}" } as const;
type Bracket = keyof typeof OPEN;

/** The first complete JSON array or object in the text, as a parsed value. */
export function extractJson(raw: string): unknown {
  const cleaned = String(raw ?? "")
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "");
  const start = cleaned.search(/[[{]/);
  if (start === -1) return null;

  const open = cleaned[start] as Bracket;
  const close = OPEN[open];
  let depth = 0;
  let inStr = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const c = cleaned[i];
    if (inStr) {
      if (c === "\\") i += 1;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * The first JSON array in the text.
 *
 * Objects are re-wrapped in an array, because a model asked for a list will
 * sometimes hand back a single object when it only found one thing, and one card
 * is a perfectly good answer.
 */
export function extractArray(raw: string): unknown[] {
  const parsed = extractJson(raw);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return [parsed];
  return [];
}