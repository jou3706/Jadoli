import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The Trusted Web Activity only becomes a real window - no URL bar, no browser
 * chrome - after Android has checked /.well-known/assetlinks.json against the
 * package id and signing certificate of the installed APK.
 *
 * The failure mode is silent: a route that serves an empty, half-filled or
 * mismatched file still builds, the app still opens, and the only symptom is a
 * URL bar and a "not verified" warning every launch. These read the route as
 * committed, because the asset file is one of the two halves (the other being
 * the APK itself) of a claim that has to hold in production.
 */

const route = readFileSync(
  new URL("../src/app/.well-known/assetlinks.json/route.ts", import.meta.url),
  "utf8",
);

test("the route is env-driven, never hardcoded", () => {
  assert.match(route, /process\.env\.ANDROID_PACKAGE_NAME/);
  assert.match(route, /process\.env\.ANDROID_SHA256_FINGERPRINT/);
});

test("the route answers 404 until both values are configured", () => {
  assert.match(route, /if \(!packageName \|\| !raw\)/);
  assert.match(route, /status: 404/);
});

test("a fingerprint in the wrong shape answers 500, never a half-true record", () => {
  assert.match(route, /^const FINGERPRINT = \/\^\(\[0-9A-F\]\{2\}:\)\{31\}\[0-9A-F\]\{2\}\$\/;$/m);
  assert.match(route, /FINGERPRINT\.test\(fingerprint\)/);
  assert.match(route, /status: 500/);
});

test("the fingerprint is normalized to one canonical uppercase colon-separated form", () => {
  assert.match(route, /\.toUpperCase\(\)/);
  assert.match(route, /raw\.replace\(\/\(\.\{2\}\)\(\?=\.\)\/g/);
});

test("the record names the standard app-to-site relation", () => {
  assert.match(route, /delegate_permission\/common\.handle_all_urls/);
  assert.match(route, /namespace: "android_app"/);
  assert.match(route, /package_name: packageName/);
  assert.match(route, /sha256_cert_fingerprints: \[fingerprint\]/);
});

test("the record always goes out uncached", () => {
  assert.match(route, /no-cache, no-store, must-revalidate/);
  assert.doesNotMatch(route, /public, max-age/);
});