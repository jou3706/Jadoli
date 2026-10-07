import { test } from "node:test";
import assert from "node:assert/strict";
import { browserStorage } from "./browser-shim.ts";
import { markOnboardingSeen, readOnboardingSeen } from "../src/lib/onboarding.ts";

browserStorage.clear();

test("an account the guide has not seen yet sees it", () => {
  assert.equal(readOnboardingSeen("u_fresh"), false);
});

test("dismissing records the account, so it never shows again", () => {
  markOnboardingSeen("u_fresh");
  assert.equal(readOnboardingSeen("u_fresh"), true);
});

test("two accounts on one device each get their own first look", () => {
  browserStorage.clear();
  markOnboardingSeen("u_alice");
  assert.equal(readOnboardingSeen("u_alice"), true);
  assert.equal(readOnboardingSeen("u_bob"), false);
});

test("an existing account that never saw the guide still gets it", () => {
  browserStorage.clear();
  assert.equal(readOnboardingSeen("u_veteran"), false);
});