/**
 * Deciding what a stored Supabase session means.
 *
 * The app used to ask the network who the user was on every load, and read any
 * failure - a slow network, no signal, a blocked request - as "nobody is
 * signed in". The token was sitting in storage the whole time. That sent a
 * signed-in person back to the login page on every reload, and made the app
 * unusable offline.
 *
 * These are kept apart from the provider so the rules can be read and tested
 * without a browser.
 */

/** Below this, a token is treated as needing a refresh rather than as good. */
export const REFRESH_MARGIN_MS = 60_000;

export type StoredSession = {
  access_token?: string | null;
  refresh_token?: string | null;
  /** Seconds since the epoch, as Supabase stores it. */
  expires_at?: number | null;
  user?: { id: string; email?: string | null } | null;
} | null;

export type SessionState =
  /** Usable as it stands: a token, a user, and time left. */
  | "valid"
  /** A session exists but needs verifying - expired, or missing its user. */
  | "stale"
  /** Nothing stored. This is a real signed-out state. */
  | "signed-out";

/**
 * Whether the app may use this session without asking the server.
 *
 * Only a token that is present, belongs to a user, and has not lapsed. A
 * session with no expiry recorded is trusted, since some clients omit it and
 * refusing to sign anyone in over a missing field would be worse.
 */
export function isUsableSession(s: StoredSession, now: number): boolean {
  return classifySession(s, now) === "valid";
}

export function classifySession(s: StoredSession, now: number): SessionState {
  if (!s || !s.access_token) return "signed-out";
  if (!s.user?.id) return "stale";
  if (!s.expires_at) return "valid";
  return s.expires_at * 1000 - REFRESH_MARGIN_MS > now ? "valid" : "stale";
}

export type AuthEvent =
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | "PASSWORD_RECOVERY"
  | (string & {});

/**
 * What to do with an auth event.
 *
 * The client emits `INITIAL_SESSION` with no session while it is still
 * recovering what is in storage. Read as a sign-out it races the restore and
 * overwrites it, which is exactly how a signed-in reload lands on the login
 * page. Everything else is taken at face value, including a token refresh that
 * arrives without a session - that one is a genuine expiry.
 */
export function classifyAuthEvent(
  event: AuthEvent,
  session: StoredSession,
): "apply" | "ignore" {
  if (event === "INITIAL_SESSION" && !session) return "ignore";
  return "apply";
}
