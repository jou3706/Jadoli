import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS, findModel, fallbackChain, readsAttachments } from "../src/lib/ai/models.ts";
import { taskModel, verifierFor } from "../src/lib/ai/routing.ts";
import type { ModelId } from "../src/lib/ai/models.ts";

const ids = (chain: { id: ModelId }[]) => chain.map((m) => m.id);

test("the chosen model is always tried first", () => {
  assert.equal(ids(fallbackChain("groq-qwen", false))[0], "groq-qwen");
});

test("the chain ends up covering every provider for a text request", () => {
  const providers = new Set(fallbackChain("gemini-38-flash", false).map((m) => m.provider));
  assert.deepEqual([...providers].sort(), ["gemini", "groq", "openrouter"]);
});

test("a sibling model comes before another provider", () => {
  const chain = fallbackChain("gemini-35-flash", false);
  // Same pool first: it shares the keys that just failed and the shape of the
  // answer, so it is the cheapest place to look before changing provider.
  assert.equal(chain[1].provider, "gemini");
  assert.equal(chain[chain.length - 1].provider, "openrouter");
});

test("an attachment filters the whole chain down to models that can read one", () => {
  const chain = fallbackChain("groq-qwen", true);
  assert.ok(chain.length > 0, "there is always a vision model to fall back to");
  assert.ok(chain.every(readsAttachments), "no text-only model can be asked to read a file");
  assert.equal(chain[0].provider, "gemini");
});

test("the chain never repeats a model", () => {
  const chain = ids(fallbackChain("gemini-38-flash", false));
  assert.equal(new Set(chain).size, chain.length);
});

test("a chain survives a model that does not exist", () => {
  // An unknown id falls back to the first model rather than throwing, and must
  // still leave a chain behind: this is decided once per request, before any
  // work, so it cannot be allowed to fail halfway through one.
  const chain = fallbackChain("not-a-real-model" as ModelId, false);
  assert.ok(chain.length >= 2);
  assert.ok(chain.every((m) => MODELS.includes(m)));
});

test("a task with no attachments is answered by a text-only model", () => {
  assert.equal(readsAttachments(findModel(taskModel("flashcards", false))), false);
});

test("an attachment overrides the task's model", () => {
  assert.equal(taskModel("flashcards", true), "gemini-35-flash");
});

test("the verifier is a different provider from the one that wrote the exam", () => {
  for (const primary of ["gemini-38-flash", "groq-120b", "or-free"] as ModelId[]) {
    const writer = findModel(primary);
    const checker = findModel(verifierFor(primary));
    assert.notEqual(checker.provider, writer.provider);
  }
});