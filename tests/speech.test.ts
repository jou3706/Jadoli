import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  composeDictation,
  langOf,
  shouldRestart,
  splitTranscript,
  type Phrase,
} from "../src/lib/speech.ts";

/**
 * Speaking a question in.
 *
 * The recogniser reports results cumulatively for a whole session, so the
 * transcript is rebuilt from the start every time instead of being appended to.
 * That choice is what the first two tests pin down: an event that never arrives,
 * or a phrase the engine revises twice, must not leave a hole or a duplicate in
 * the box.
 *
 * The restart policy is the other half. `continuous = true` reads as "keeps
 * listening" and Chrome still ends the session on every pause, so the only thing
 * keeping dictation alive is restarting from onend - and the only thing that
 * would keep it alive wrongly is restarting after a permission was refused.
 */

const phrase = (text: string, final: boolean, lang = "en-US"): Phrase => ({
  text,
  final,
  lang,
});

test("finished phrases are kept and the unfinished one is held aside", () => {
  const { committed, interim } = splitTranscript([
    phrase("what is on", true),
    phrase("what is on friday", true),
    phrase("tomorrow", false),
  ]);
  assert.equal(committed, "what is on what is on friday");
  // Only the newest unfinished phrase: earlier ones are revised and arrive again.
  assert.equal(interim, "tomorrow");
});

test("only the newest unfinished phrase is interim, never a stack of them", () => {
  // Two live partials for the same stretch of speech would otherwise be shown as
  // one line, with the older wording stuck in front of the newer.
  const { interim } = splitTranscript([
    phrase("I have a lec", false),
    phrase("I have a lecture at", false),
  ]);
  assert.equal(interim, "I have a lecture at");
});

test("a finalised phrase never comes back as interim", () => {
  // The engine marks a phrase final and then still revises it once; if the final
  // copy were also left in the interim slot the box would show it twice.
  const { committed, interim } = splitTranscript([
    phrase("eight am", true),
    phrase("eight am", false),
  ]);
  assert.equal(committed, "eight am");
  assert.equal(interim, "eight am");
});

test("a phrase that turns out to be empty is dropped, not joined as a gap", () => {
  // Silence arrives as an empty final phrase often enough that keeping it would
  // leave double spaces the engine never said.
  const { committed, interim } = splitTranscript([
    phrase("hello", true),
    phrase("   ", true),
    phrase("", false),
  ]);
  assert.equal(committed, "hello");
  assert.equal(interim, "");
});

test("the whole transcript is rebuilt, so a dropped event leaves no hole", () => {
  // Results are cumulative: rebuilding from all of them is why missing one event
  // loses an update rather than losing a phrase.
  const results = [phrase("first part", true), phrase("second part", true)];
  assert.equal(splitTranscript(results).committed, "first part second part");
  // The same list again, as it arrives after the next event, still reads whole.
  const grown = [...results, phrase("third part", true)];
  assert.equal(splitTranscript(grown).committed, "first part second part third part");
  assert.equal(
    splitTranscript(results).committed,
    "first part second part",
    "rebuilding must not accumulate across calls",
  );
});

test("the language is read from the newest phrase that reported one", () => {
  assert.equal(splitTranscript([phrase("مرحبا", true, "ar-EG")]).detected, "ar-EG");
  // The engine reports a language per phrase rather than per session, so the
  // newest one is the honest label to show.
  const switched = splitTranscript([
    phrase("what time", true, "en-US"),
    phrase("امتى", true, "ar-EG"),
  ]);
  assert.equal(switched.detected, "ar-EG");
  assert.equal(langOf(switched.detected), "ar");
});

test("both app languages are recognised from a regional tag", () => {
  assert.equal(langOf("ar-EG"), "ar");
  assert.equal(langOf("ar"), "ar");
  assert.equal(langOf("en-US"), "en");
  assert.equal(langOf("EN-gb"), "en");
  // Some Android WebViews report an underscore. Only a label rides on this, so
  // accepting it costs nothing and a silent "unknown" would be worse.
  assert.equal(langOf("en_US"), "en");
});

test("a tag that merely starts like a language is not one", () => {
  // A prefix test would call these English. They are not, and the student would
  // be told they were recognised in a language the assistant does not answer in.
  assert.equal(langOf("enigma"), null);
  assert.equal(langOf("art"), null);
});

test("a language this app does not speak is left unknown", () => {
  // Reported so the student is not told they were recognised in a language the
  // assistant does not answer in.
  assert.equal(langOf("fr-FR"), null);
  assert.equal(langOf(""), null);
  assert.equal(langOf(null), null);
  assert.equal(langOf(undefined), null);
});

test("dictation is added to what was already typed, not put over it", () => {
  assert.equal(composeDictation("lecture 3", "what is due", "tomorrow"), "lecture 3 what is due tomorrow");
  assert.equal(composeDictation("", "hello", ""), "hello");
  assert.equal(composeDictation("note to self", "", ""), "note to self");
  assert.equal(composeDictation("", "", ""), "");
});

test("no stray space is left where dictation starts or stops", () => {
  // The empty halves are common - nothing committed yet, or nothing pending - so
  // they must not contribute separators.
  assert.equal(composeDictation("", "", "sp"), "sp");
  assert.equal(composeDictation("base ", " done ", " more "), "base done more");
});

test("a pause in speech does not end dictation", () => {
  // Chrome ends the session after a pause even with continuous: true, so this is
  // the case that keeps the microphone open.
  assert.equal(shouldRestart(undefined), true, "a silence ends the session and must restart it");
  assert.equal(shouldRestart(null), true);
  assert.equal(shouldRestart("no-speech"), true);
});

test("a refusal or a missing microphone is not retried", () => {
  // Restarting any of these either spins forever or asks again for a permission
  // the student already said no to.
  for (const code of ["not-allowed", "service-not-allowed", "audio-capture", "network", "aborted"]) {
    assert.equal(shouldRestart(code), false, `${code} must stop dictation, not restart it`);
  }
});

test("stopping on purpose is what ends it", () => {
  // `wantRef` decides this, not the error code, but the policy has to agree: a
  // deliberate stop must not look like something to retry.
  assert.equal(shouldRestart("aborted"), false);
});

const speechSrc = readFileSync(new URL("../src/lib/speech.ts", import.meta.url), "utf8");

test("dictation is pinned to an explicit language, never the browser's", () => {
  // An unset `lang` does not make Chrome detect the speech - it quietly uses the
  // browser's own UI language, which is the whole English-only bug. Every
  // recognition session gets the chosen language on the instance.
  assert.match(speechSrc, /export type DictationLang = "ar" \| "en";/);
  assert.match(speechSrc, /const chosen = langRef\.current/);
  assert.match(speechSrc, /if \(chosen\) rec\.lang = chosen/);
});

test("the page passes the chosen language into every session", () => {
  // The hook default is "no opinion", which resolves to the browser's language.
  // The page always pins one, and this test exists so a future edit cannot
  // silently take that away again.
  const page = readFileSync(
    new URL("../src/app/(app)/assistant/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /useSpeechToText\(\(text\) => setInput\(text\), recLang\)/);
});