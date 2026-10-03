import { test } from "node:test";
import assert from "node:assert/strict";
import { browserStorage } from "./browser-shim.ts";
import {
  getAlarmPrefs,
  notificationsEnabled,
  resetAlarmPrefs,
  setAlarmPref,
  soundEnabled,
  subscribeAlarmPrefs,
} from "../src/lib/alarm-prefs.ts";

test("both switches start off, because a browser must be asked first", () => {
  browserStorage.clear();
  resetAlarmPrefs();
  assert.deepEqual(getAlarmPrefs(), { sound: false, notifications: false });
  assert.equal(soundEnabled(), false);
  assert.equal(notificationsEnabled(), false);
});

test("a switch stays where it was left, across a reload", () => {
  browserStorage.clear();
  resetAlarmPrefs();
  setAlarmPref("sound", true);
  // A reload forgets the cache, not the choice.
  resetAlarmPrefs();
  assert.equal(soundEnabled(), true);

  setAlarmPref("sound", false);
  resetAlarmPrefs();
  assert.equal(soundEnabled(), false);
});

test("the two switches are independent", () => {
  browserStorage.clear();
  resetAlarmPrefs();
  setAlarmPref("sound", true);
  assert.deepEqual(getAlarmPrefs(), { sound: true, notifications: false });
  setAlarmPref("notifications", true);
  assert.deepEqual(getAlarmPrefs(), { sound: true, notifications: true });
});

test("listeners hear every change, and stop when unsubscribed", () => {
  browserStorage.clear();
  resetAlarmPrefs();
  let heard = 0;
  const stop = subscribeAlarmPrefs(() => {
    heard += 1;
  });
  setAlarmPref("sound", true);
  setAlarmPref("notifications", true);
  assert.equal(heard, 2);
  stop();
  setAlarmPref("sound", false);
  assert.equal(heard, 2, "an unsubscribed listener is not called");
});

test("junk in storage reads as off, never as on", () => {
  browserStorage.clear();
  resetAlarmPrefs();
  for (const junk of ["not json", '{"sound":"yes"}', "null", '{"sound":1}']) {
    browserStorage.set("jadoli:alarm-prefs", junk);
    resetAlarmPrefs();
    assert.deepEqual(
      getAlarmPrefs(),
      { sound: false, notifications: false },
      `for ${junk}`,
    );
  }
});
