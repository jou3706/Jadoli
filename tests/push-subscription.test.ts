import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { shouldNotifyInApp } from "../src/lib/push-subscription.ts";

/**
 * One notification per alarm.
 *
 * Both paths ring for the same event - the page while it is open, the push job
 * while it is closed - and they used to raise a notification each, under the
 * same tag, so whichever arrived second replaced the first. The fix is that
 * exactly one of them owns the notification, and which one is decided by where
 * the student is standing rather than by whether a push happens to be
 * subscribed.
 */

test("the page in front of the student says something", () => {
  assert.equal(shouldNotifyInApp({ visible: true, subscribed: false }), true);
  // And it says something even when a push is subscribed: the worker stands
  // down while the page is awake, so the page's is the only one there is.
  assert.equal(shouldNotifyInApp({ visible: true, subscribed: true }), true);
});

test("a page in the background leaves it to the push", () => {
  // A notification raised by a hidden tab is a notification nobody looks at,
  // and the push arrives on the lock screen whether the tab is open or not.
  assert.equal(shouldNotifyInApp({ visible: false, subscribed: true }), false);
});

test("with no push at all, the page says it whatever else is true", () => {
  // There is nobody else to say anything: a phone with no subscription hears the
  // alarm's sound and must still see it.
  assert.equal(shouldNotifyInApp({ visible: false, subscribed: false }), true);
  assert.equal(shouldNotifyInApp({ visible: true, subscribed: false }), true);
});

test("the rule is wired into the alarm, not merely defined", async () => {
  // A helper nobody calls is worse than no helper: it reads as the fix and
  // changes nothing. Read the hook and prove the decision is made where the
  // notification is raised.
  const source = await readFile(
    new URL("../src/hooks/use-event-alarms.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /shouldNotifyInApp\(\{/);
  assert.match(source, /visible: document\.visibilityState === "visible"/);
  assert.match(source, /subscribed: await isPushSubscribed\(\)/);
  // And it has to be inside the guard that raises the notification, not beside it.
  const raise = source.match(/new Notification\(/);
  assert.ok(raise, "the hook no longer raises a notification at all");
  const before = source.slice(0, raise.index);
  assert.ok(
    before.includes("shouldNotifyInApp"),
    "the guard must be part of the condition that raises the notification",
  );
});

test("the page tells the worker that it is awake", async () => {
  // The worker stands down for a push while the page is in front of the
  // student. It needs to hear that the page is alive to do that, and "alive" is
  // not a thing that is said once - so the claim is renewed.
  const source = await readFile(
    new URL("../src/hooks/use-event-alarms.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /reportAlarmsLive\(\)/);
  assert.match(source, /setInterval\(\(\) => reportAlarmsLive\(\)/);

  const lib = await readFile(
    new URL("../src/lib/push-subscription.ts", import.meta.url),
    "utf8",
  );
  assert.match(lib, /jadwali:alarms-live/);
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

test("a subscription made under an old key is repaired, not left failing", async () => {
  // The failure this prevents is silent and total: a subscription made under a
  // key pair that no longer signs for it is refused by the push service with a
  // bare 403, the browser still believes it is subscribed, the job runs every
  // minute, and no reminder ever arrives.
  const source = await readFile(new URL("../src/hooks/use-push.ts", import.meta.url), "utf8");
  // The browser has to compare the key the subscription was made with against
  // the one the deployment publishes now.
  assert.match(source, /sameApplicationKey\(existing, vapidPublicKey\)/);
  assert.match(source, /options\?\.applicationServerKey/);
  // And when they differ, it has to subscribe again under the current key.
  assert.match(source, /renew\(reg, existing, vapidPublicKey\)/);
  assert.match(source, /pushManager\.subscribe\(\{/);
  // The dead row is removed from the server, or the job keeps trying it.
  assert.match(source, /await unsubscribe\(oldEndpoint\)/);
});

test("the repair needs the permission it is going to use", async () => {
  // Re-subscribing is the browser's own business, but it still needs the
  // permission to have been granted - asking again would be a prompt the
  // student never agreed to.
  const source = await readFile(new URL("../src/hooks/use-push.ts", import.meta.url), "utf8");
  assert.match(source, /if \(Notification\.permission !== "granted"\) return false;/);
});

test("a subscription that cannot be told apart is left alone", async () => {
  // Some browsers do not expose the key a subscription was made with. Guessing
  // there would churn a working subscription for nothing, so "cannot tell" is
  // its own answer and not a mismatch.
  const source = await readFile(new URL("../src/hooks/use-push.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!stored\) return null;/);
  assert.match(source, /=== false/);
});

