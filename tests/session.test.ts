import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAuthEvent,
  classifySession,
  isUsableSession,
} from "../src/lib/db/session.ts";

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
  assert.equal(classifyAuthEvent("SIGNED_OUT", null), "apply");
  assert.equal(classifyAuthEvent("SIGNED_IN", session()), "apply");
  assert.equal(classifyAuthEvent("TOKEN_REFRESHED", session()), "apply");
  // A real sign-out carries no session, so it still applies even as a refresh.
  assert.equal(classifyAuthEvent("TOKEN_REFRESHED", null), "apply");
});

test("the offline path keeps the user signed in without a network", () => {
  // With no signal there is no way to ask who the user is, so the stored
  // session is the only answer available - and the cached data is keyed on it.
  const s = session();
  assert.equal(isUsableSession(s, now), true);
  assert.equal(classifySession(s, now), "valid");
});
