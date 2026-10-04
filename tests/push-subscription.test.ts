import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { shouldNotifyInApp } from "../src/lib/push-subscription.ts";

/**
 * One notification per alarm.
 *
 * Both paths ring for the same event - the page while it is open, the push job
 * while it is closed - and they used to raise a notification each, under the
 * same tag, so whichever arrived second replaced the first. The fix is that only
 * one of them owns the notification, and which one is decided by whether the
 * browser can be reached with a push at all.
 */

test("a browser with a push does not need the page to shout", () => {
  // The push will arrive whether or not the tab is open, and it lands within a
  // minute. The page ringing as well means the second one replaces the first, and
  // it is the in-app one that gets replaced - the sticky one.
  assert.equal(shouldNotifyInApp(true), false);
});

test("a browser without a push has nothing but the page", () => {
  // Turning this off here would mean an alarm that is silent on a phone with no
  // subscription: the sound plays, but there is nothing on the lock screen.
  assert.equal(shouldNotifyInApp(false), true);
});

test("the rule is wired into the alarm, not merely defined", async () => {
  // A helper nobody calls is worse than no helper: it reads as the fix and
  // changes nothing. Read the hook and prove the decision is made where the
  // notification is raised.
  const source = await readFile(
    new URL("../src/hooks/use-event-alarms.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /shouldNotifyInApp\(await isPushSubscribed\(\)\)/);
  // And it has to be inside the guard that raises the notification, not beside it.
  const raise = source.match(/new Notification\(/);
  assert.ok(raise, "the hook no longer raises a notification at all");
  const before = source.slice(0, raise.index);
  assert.ok(
    before.includes("shouldNotifyInApp"),
    "the guard must be part of the condition that raises the notification",
  );
});

test("turning the switch over clears what the page believes about it", async () => {
  // The answer is cached for the page's lifetime, because asking storage on
  // every tick would mean a round trip per tick. So whoever changes the answer
  // has to say so, or the first alarm after switching on would still be handled
  // as though nothing had changed.
  const source = await readFile(new URL("../src/hooks/use-push.ts", import.meta.url), "utf8");
  const clears = source.match(/invalidatePushSubscription\(\)/g) ?? [];
  assert.ok(
    clears.length >= 2,
    "the cache must be cleared on the way off and on the way on",
  );
  const mod = await readFile(
    new URL("../src/lib/push-subscription.ts", import.meta.url),
    "utf8",
  );
  assert.match(mod, /export const invalidatePushSubscription = \(\) => \{\s*cached = null;/);
});