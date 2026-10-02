import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAuthEvent,
  classifySession,
  classifySignOut,
  isUsableSession,
  readStoredSession,
} from "../src/lib/db/session.ts";
import { AuthExpiredError, isAuthExpired, isRetryableLater, OfflineError } from "../src/lib/db/offline.ts";

const now = 1_000_000_000_000;
const HOUR = 3_600_000;

const session = (over: Partial<Parameters<typeof isUsableSession>[0]> = {}) => ({
  access_token: "tok",
  refresh_token: "ref",
  expires_at: Math.floor((now + HOUR) / 1000),
  user: { id: "u1", email: "a@b.c" },
  ...over,
});

test("a stored session with time left on it is used on reload", () => {
  // The reported bug: every reload sent the user back to the login page even
  // though the token was in storage the whole time.
  assert.equal(isUsableSession(session(), now), true);
});

test("a session with no token cannot be used", () => {
  assert.equal(isUsableSession(session({ access_token: "" }), now), false);
  assert.equal(isUsableSession(session({ access_token: undefined }), now), false);
});

test("an expired session is not used as-is", () => {
  // Expired is not the same as signed out: the client can still refresh it, so
  // it must be verified rather than discarded.
  const past = session({ expires_at: Math.floor((now - HOUR) / 1000) });
  assert.equal(isUsableSession(past, now), false);
  assert.equal(classifySession(past, now), "stale");
});

test("a token that lapses in a moment is given room to refresh", () => {
  const nearly = session({ expires_at: Math.floor((now + 5_000) / 1000) });
  assert.equal(classifySession(nearly, now), "stale", "close enough to need a refresh");
  const comfortable = session({ expires_at: Math.floor((now + 10 * 60_000) / 1000) });
  assert.equal(classifySession(comfortable, now), "valid", "an hour is not in doubt");
});

test("no session at all is a signed-out state, not a network failure", () => {
  assert.equal(classifySession(null, now), "signed-out");
  assert.equal(isUsableSession(null, now), false);
});

test("a session with a token but no user still needs verifying", () => {
  // Enough to attempt a refresh, not enough to trust: the user object is what
  // the app keys its cached data on.
  const noUser = session({ user: null });
  assert.equal(isUsableSession(noUser, now), false);
  assert.equal(classifySession(noUser, now), "stale");
});

test("an auth event that only says hello is not a sign-out", () => {
  // INITIAL_SESSION with no session is the restore path reporting itself.
  // Read as a sign-out it races the restore and undoes it, which is how a
  // signed-in person ends up on the login page.
  assert.equal(classifyAuthEvent("INITIAL_SESSION", null), "ignore");
  assert.equal(classifyAuthEvent("INITIAL_SESSION", session()), "apply");
  assert.equal(classifyAuthEvent("SIGNED_IN", session()), "apply");
  assert.equal(classifyAuthEvent("TOKEN_REFRESHED", session()), "apply");
});

test("a sign-out is only honoured when storage is actually empty", () => {
  // The client emits SIGNED_OUT when a token refresh fails, including when the
  // cause is no network at all. Storage is what settles it: a real sign-out
  // empties it, a failed refresh leaves the session sitting there. Trusting the
  // event instead is what logged people out offline.
  assert.equal(
    classifySignOut("SIGNED_OUT", session()),
    "keep",
    "session still in storage: this was a failed refresh, not a sign-out",
  );
  assert.equal(classifySignOut("SIGNED_OUT", null), "sign-out", "storage is empty");
  // A refresh event carrying no session is a genuine expiry, and applies even
  // though storage may still hold the old session.
  assert.equal(classifySignOut("TOKEN_REFRESHED", null), "sign-out");
});

test("the session in storage is read even when its token has expired", () => {
  // This is the reported bug. An expired token with no network makes the client
  // report `session: null` while the session is still sitting in storage, so
  // anything that trusts that report signs the user out. Storage is the
  // ground truth for "is this person signed in".
  const expired = JSON.stringify({
    access_token: "stale",
    refresh_token: "ref",
    expires_at: Math.floor((now - HOUR) / 1000),
    user: { id: "u1", email: "a@b.c" },
  });
  const storage = { getItem: (k: string) => (k === "jadoli_sb_session" ? expired : null) };
  const read = readStoredSession(storage);
  assert.equal(read?.user?.id, "u1", "the person is still here");
  assert.equal(read?.access_token, "stale");
});

test("an empty storage is a real sign-out", () => {
  const storage = { getItem: () => null };
  assert.equal(readStoredSession(storage), null);
});

test("the split-storage layout is read as one session", () => {
  // With a separate user store the user object is not on the session itself.
  const items: Record<string, string> = {
    jadoli_sb_session: JSON.stringify({
      access_token: "tok",
      refresh_token: "ref",
      expires_at: Math.floor((now + HOUR) / 1000),
    }),
    "jadoli_sb_session-user": JSON.stringify({ user: { id: "u9", email: "b@c.d" } }),
  };
  const read = readStoredSession({ getItem: (k) => items[k] ?? null });
  assert.equal(read?.user?.id, "u9");
  assert.equal(read?.access_token, "tok");
});

test("unusable storage does not throw", () => {
  // Private browsing refuses to read localStorage at all.
  const blocked = {
    getItem: () => {
      throw new Error("SecurityError");
    },
  };
  assert.equal(readStoredSession(blocked), null);
  // And half-written JSON is not worth crashing the app over.
  assert.equal(readStoredSession({ getItem: () => "{not json" }), null);
});

test("a stored session with a lapsed token still has a user in it", () => {
  const lapsed = session({ expires_at: Math.floor((now - HOUR) / 1000) });
  assert.equal(isUsableSession(lapsed, now), false, "not usable for a server call");
  assert.equal(
    Boolean(lapsed?.user?.id),
    true,
    "but the person is still signed in, which is what the app asks",
  );
});

test("a rejected token is 'not now', not a refusal of the row", () => {
  // An expired token offline makes every request come back 401. Treating that
  // like a bad row meant reads threw an error over data the user is entitled to
  // see, and - worse - the replay path dropped every queued write, because a
  // queued write is the only copy until the server accepts it.
  const expired = new AuthExpiredError("Supabase 401: JWT expired");
  assert.equal(isAuthExpired(expired), true);
  assert.equal(isRetryableLater(expired), true, "a refresh fixes this, so hold on");
});

test("a genuine refusal is still raised to the caller", () => {
  // Repeating these on every reconnect would fail forever.
  for (const message of [
    "Supabase 409: duplicate key",
    "Supabase 403: new row violates row-level security",
    "Supabase 400: bad column",
  ]) {
    assert.equal(isRetryableLater(new Error(message)), false, message);
  }
});

test("a dead network is still 'not now'", () => {
  assert.equal(isRetryableLater(new OfflineError("offline: Lecture unreachable")), true);
});

test("the offline path keeps the user signed in without a network", () => {
  // With no signal there is no way to ask who the user is, so the stored
  // session is the only answer available - and the cached data is keyed on it.
  const s = session();
  assert.equal(isUsableSession(s, now), true);
  assert.equal(classifySession(s, now), "valid");
});
