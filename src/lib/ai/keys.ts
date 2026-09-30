import "server-only";

/**
 * Server-only AI key pools.
 *
 * Every key lives in an environment variable and is read ONLY here. Nothing in
 * this module may be imported from a client component — `server-only` makes
 * that a build error rather than a silent leak.
 *
 * Pools are comma-separated so you can add or remove keys without a code
 * change. Cooldowns are kept per-process in memory.
 */

export type Provider = "gemini" | "groq" | "openrouter";

const parse = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

const pools: Record<Provider, string[]> = {
  gemini: parse(process.env.GEMINI_API_KEYS),
  groq: parse(process.env.GROQ_API_KEYS),
  openrouter: parse(process.env.OPENROUTER_API_KEYS),
};

export type KeyState = {
  provider: Provider;
  key: string;
  index: number;
  /** Epoch ms until which this key is skipped. */
  cooldownUntil: number;
  failures: number;
};

const state = new Map<string, KeyState>();
const keyId = (p: Provider, i: number) => `${p}:${i}`;

for (const p of Object.keys(pools) as Provider[]) {
  pools[p].forEach((key, i) => {
    state.set(keyId(p, i), {
      provider: p,
      key,
      index: i,
      cooldownUntil: 0,
      failures: 0,
    });
  });
}

export const poolSize = (p: Provider) => pools[p].length;
export const totalKeys = () =>
  (Object.keys(pools) as Provider[]).reduce((n, p) => n + pools[p].length, 0);

export const hasKeys = (p?: Provider) =>
  p ? pools[p].length > 0 : totalKeys() > 0;

/**
 * Ordered candidates for a provider: available keys first, then the ones in
 * cooldown (so a request is never refused purely because every key is cooling).
 */
export function candidates(p: Provider): KeyState[] {
  const all = pools[p].map((_, i) => state.get(keyId(p, i))!);
  const now = Date.now();
  const free = all.filter((s) => s.cooldownUntil <= now);
  const cooling = all.filter((s) => s.cooldownUntil > now);
  return [...free, ...cooling];
}

const RATE_LIMIT = /429|RESOURCE_EXHAUSTED|rate|quota|overloaded|UNAVAILABLE|insufficient/i;
const AUTH_FAIL = /403|402|401|unauthor|permission|invalid|forbidden/i;

/** Back a key off after a failure. Returns the cooldown in ms. */
export function penalize(s: KeyState, message: string): number {
  const err = String(message ?? "");
  let ms = 30_000;
  if (RATE_LIMIT.test(err)) ms = 60_000;
  if (AUTH_FAIL.test(err)) ms = 6 * 60 * 60_000;

  s.failures += 1;
  // Escalate for repeated failures on the same key.
  const escalated = ms * Math.min(4, 1 + (s.failures - 1) * 0.5);
  s.cooldownUntil = Date.now() + Math.round(escalated);
  return Math.round(escalated);
}

export function clearPenalty(s: KeyState) {
  s.failures = 0;
  s.cooldownUntil = 0;
}

/** Safe summary for diagnostics — never leaks a full key. */
export function describePools() {
  return (Object.keys(pools) as Provider[]).map((p) => ({
    provider: p,
    total: pools[p].length,
    cooling: candidates(p).filter((s) => s.cooldownUntil > Date.now()).length,
  }));
}
