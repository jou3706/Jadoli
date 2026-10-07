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

export type SessionStorage = {
  getItem(key: string): string | null;
};

/** Matches the `storageKey` the client is built with in supabase-client.ts. */
export const SUPABASE_SESSION_KEY = "jadwali_sb_session";

/**
 * The session as it sits in storage, read directly.
 *
 * This exists because `getSession()` cannot answer the only question that
 * matters offline. When the access token has expired and the refresh cannot
 * reach the server, the client keeps the session in storage but reports
 * `session: null` - it will not hand back a token it knows is stale. The user is
 * still signed in; the client simply refuses to say so. Reading storage is how
 * the app can tell the difference between that and a real sign-out, where
 * storage is empty because the user asked to leave.
 *
 * Handles the split-storage shape too, where the user sits under its own key.
 */
export function readStoredSession(
  storage: SessionStorage,
  key: string = SUPABASE_SESSION_KEY,
): StoredSession {
  const read = (k: string) => {
    try {
      return storage.getItem(k);
    } catch {
      // Private-mode Safari and similar refuse to read storage at all.
      return null;
    }
  };
  const parse = (raw: string | null) => {
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object") return null;
      const record = value as Record<string, unknown>;
      const session = (record.session ?? record) as Record<string, unknown>;
      if (!session || typeof session !== "object") return null;
      const user =
        (session.user as StoredSession extends null ? never : NonNullable<StoredSession>["user"]) ??
        (record.user as NonNullable<StoredSession>["user"]) ??
        null;
      return { ...session, user } as NonNullable<StoredSession>;
    } catch {
      return null;
    }
  };
  const main = parse(read(key));
  if (!main) return null;
  if (!main.user) {
    const separate = parse(read(`${key}-user`));
    if (separate?.user) return { ...main, user: separate.user };
  }
  return main;
}

/**
 * Whether an event without a session means the user actually left.
 *
 * The client emits `SIGNED_OUT` when a token refresh fails, and a refresh fails
 * for reasons that have nothing to do with the user - most often no network at
 * all. Storage settles it: a real sign-out empties it, because that is what
 * `signOut()` does, while a failed refresh leaves the session sitting there.
 * Believing the event is what put people on the login page with no signal.
 */
export function classifySignOut(
  event: AuthEvent,
  session: StoredSession,
): "sign-out" | "keep" {
  if (event !== "SIGNED_OUT") return session ? "keep" : "sign-out";
  return session ? "keep" : "sign-out";
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
