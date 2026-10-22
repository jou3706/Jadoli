import { readFile } from "node:fs/promises";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VIDEO_MIME,
  findYouTubeLinks,
  isYouTubeVideo,
  youtubeFileUri,
  youtubeLabel,
  youtubeVideoId,
} from "../src/lib/ai/video.ts";
import { fallbackChain, readsVideos } from "../src/lib/ai/models.ts";
import { cardableMaterial } from "../src/lib/material-cards.ts";
import { chatBodySchema } from "../src/lib/ai/schema.ts";

/**
 * A recording of a lecture is a material the student already has.
 *
 * The rule that matters: the video is watched, not guessed at. A model handed a
 * link as text will write beautiful questions about a video nobody opened, and
 * the student cannot tell a wrong flashcard from a right one at revision time.
 */

const ID = "dQw4w9WgXcQ";

const providersSrc = () =>
  readFile(new URL("../src/lib/ai/providers.ts", import.meta.url), "utf8");
const modelsSrc = () =>
  readFile(new URL("../src/lib/ai/models.ts", import.meta.url), "utf8");
const fetchSrc = () =>
  readFile(new URL("../src/lib/ai/material-fetch.ts", import.meta.url), "utf8");

test("a YouTube link is recognised in every shape it is copied in", () => {
  const links = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `http://m.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=${ID}&list=PL1234567890&index=2`,
    `https://www.youtube.com/watch?v=${ID}&t=42s`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?t=90`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/v/${ID}`,
  ];
  for (const link of links) {
    assert.equal(youtubeVideoId(link), ID, `${link} should be a video`);
    assert.equal(isYouTubeVideo(link), true);
  }
});

test("something that is not a video link is not one", () => {
  for (const link of [
    "",
    "   ",
    "not a url",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/",
    "https://youtube.com/watch",
    "https://youtube.com/watch?v=tooshort",
    "https://youtube.com/watch?v=waaaaaaaaaaaaaaaytoolong",
    // A channel is not a video.
    "https://www.youtube.com/@someone",
    "https://www.youtube.com/playlist?list=PL1234567890",
    "https://vimeo.com/123456789",
    "https://drive.google.com/file/d/abc/view",
  ]) {
    assert.equal(youtubeVideoId(link), null, `${link} should not be a video`);
    assert.equal(isYouTubeVideo(link), false);
  }
});

test("the model is given the video itself, not the address a student pasted", () => {
  // The canonical form is rebuilt from the id, so a playlist or a timestamp in
  // the pasted link does not travel to the model as part of the video.
  assert.equal(
    youtubeFileUri(`https://youtu.be/${ID}?t=90&list=PL1`),
    `https://www.youtube.com/watch?v=${ID}`,
  );
  assert.equal(youtubeFileUri("https://example.com"), null);
});

test("the video is declared as a video", () => {
  assert.equal(VIDEO_MIME, "video/mp4");
});

test("only the models that can watch a video are offered one", () => {
  const chain = fallbackChain("gemini-35-flash", false, true);
  assert.ok(chain.length > 0, "a video needs somebody to watch it");
  for (const model of chain) {
    assert.equal(readsVideos(model), true, `${model.id} cannot watch a video`);
    assert.equal(model.provider, "gemini", `${model.id} is not a video reader`);
  }
});

test("a text model is not asked to watch a video", () => {
  // The chain starts from the model that wrote the request, and skips it when it
  // cannot open what is attached. The other pools are added afterwards.
  const chain = fallbackChain("groq-20b", false, true);
  assert.ok(chain.length > 0);
  for (const model of chain) {
    assert.equal(model.provider, "gemini", `${model.id} cannot watch a video`);
  }
});

test("a request without a video is not narrowed to the video readers", () => {
  const chain = fallbackChain("groq-20b", false, false);
  assert.ok(
    chain.some((m) => m.provider !== "gemini"),
    "a plain text request should still reach the other pools",
  );
});

test("the video travels as an address the model fetches, never as bytes", async () => {
  const text = await providersSrc();
  assert.match(text, /file_data:\s*\{\s*file_uri:/);
  assert.match(text, /mime_type:\s*v\.mime \?\? VIDEO_MIME/);
  // The video must not be downloaded and carried in the request body.
  assert.ok(
    !/videos?.*dataUrl/.test(text),
    "a video must not be sent as a data url",
  );
});

test("the chain knows a video is not an image", async () => {
  const text = await modelsSrc();
  assert.match(text, /export function fallbackChain\([\s\S]*?hasVideo = false/);
  assert.match(text, /if \(hasVideo && !readsVideos\(m\)\) return;/);
});

test("a saved YouTube link is a readable material", () => {
  const cardable = cardableMaterial({
    id: "m1",
    title: "lecture 3 recording",
    url: `https://youtu.be/${ID}`,
    type: "video",
    file_path: "",
    size: 0,
  } as never);
  assert.equal(cardable.ok, true, "a YouTube recording can be read");
  assert.equal(cardable.mime, VIDEO_MIME);
});

test("a video that is not on YouTube is still refused", () => {
  const cardable = cardableMaterial({
    id: "m2",
    title: "a recording on a drive",
    url: "https://drive.google.com/file/d/abc/view",
    type: "video",
    file_path: "",
    size: 0,
  } as never);
  assert.equal(cardable.ok, false);
  assert.equal(cardable.reason, "video");
});

test("the server reads a saved link into a video", async () => {
  const text = await fetchSrc();
  assert.match(text, /youtubeFileUri\(owned\.url\)/);
  assert.match(text, /videos\.push\(\{ title: owned\.title \|\| "video", uri \}\)/);
  // A link that is not a video is reported as a link, so the student is told to
  // download it rather than told it is not theirs.
  assert.match(text, /reason: "LINK"/);
});

test("the video is named to the model, so the answer can be traced back", async () => {
  const text = await fetchSrc();
  assert.match(text, /video \$\{i \+ 1\}: /);
  // And the model is told what to do with it.
  const video = await readFile(new URL("../src/lib/ai/video.ts", import.meta.url), "utf8");
  assert.match(video, /export const VIDEO_INSTRUCTION/);
});

test("a link pasted into a sentence is found, punctuation and all", () => {
  // The student writes "watch this https://youtu.be/dQw4w9WgXcQ." and means the
  // video, not the full stop.
  assert.deepEqual(
    findYouTubeLinks(`watch this https://youtu.be/${ID}.`),
    [`https://www.youtube.com/watch?v=${ID}`],
  );
  assert.deepEqual(
    findYouTubeLinks(`explain ${ID ? `https://youtu.be/${ID}` : ""}`),
    [`https://www.youtube.com/watch?v=${ID}`],
  );
});

test("a sentence with no video in it finds nothing", () => {
  assert.deepEqual(findYouTubeLinks("what is the difference between a mutex and a semaphore?"), []);
  assert.deepEqual(findYouTubeLinks("see https://example.com/lecture.mp4"), []);
  assert.deepEqual(findYouTubeLinks(""), []);
});

test("the same video twice is attached once", () => {
  const links = findYouTubeLinks(`https://youtu.be/${ID} and again https://youtu.be/${ID}`);
  assert.equal(links.length, 1);
});

test("a saved video has a name the student can recognise", () => {
  assert.equal(youtubeLabel(`https://youtu.be/${ID}`), `YouTube ${ID}`);
  assert.equal(youtubeLabel("https://example.com"), null);
});

test("the chat accepts a video and refuses anything else", () => {
  const good = chatBodySchema.safeParse({
    model: "gemini-35-flash",
    question: "summarise this",
    videos: [{ uri: `https://www.youtube.com/watch?v=${ID}` }],
  });
  assert.equal(good.success, true);

  // The model fetches the address it is given, so the address has to be one it
  // is allowed to open. Anything else is refused rather than fetched.
  const other = chatBodySchema.safeParse({
    model: "gemini-35-flash",
    question: "summarise this",
    videos: [{ uri: "https://example.com/lesson.mp4" }],
  });
  assert.equal(other.success, false);
});

test("the assistant is told to watch the video, not to describe it", async () => {
  const route = await readFile(
    new URL("../src/app/api/ai/chat/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /videos: videos\.map\(/);
  assert.match(route, /VIDEO_INSTRUCTION/);
});

test("a pasted link is sent to the model as a video", async () => {
  const page = await readFile(
    new URL("../src/app/(app)/assistant/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /findYouTubeLinks\(question\)/);
  assert.match(page, /videos,/);
});

