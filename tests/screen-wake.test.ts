import { test } from "node:test";
import assert from "node:assert/strict";
import { holdScreenAwake, wakeSupported } from "../src/lib/screen-wake.ts";

test("a browser without the wake lock API is reported, not faked", () => {
  // No Screen Wake Lock here, which is exactly the situation of an old browser.
  // Claiming support would show a switch that silently does nothing.
  assert.equal(wakeSupported(), false);
});

test("asking to hold the screen awake where it cannot be held is a no-op", () => {
  // The release function must still be safe to call, or turning the switch off
  // in a browser that never granted it would throw on the way out.
  const release = holdScreenAwake();
  assert.equal(typeof release, "function");
  assert.doesNotThrow(() => release());
  assert.doesNotThrow(() => release(), "releasing twice is still a no-op");
});