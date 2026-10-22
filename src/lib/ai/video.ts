/**
 * A YouTube link as something a model can read.
 *
 * Gemini takes a video by its address: the request carries the link itself and
 * the model fetches and watches it. Nothing is downloaded here, nothing is
 * transcribed, and no third-party service is paid for - the video is read by
 * the same model that reads the lecture notes, so a student who saved a
 * recording of a lecture gets cards out of the lecture rather than out of its
 * title.
 *
 * This is the only reason a video can be a material at all. A link handed to a
 * model as plain text produces confident, well-formatted questions about a
 * video nobody watched, and a wrong flashcard is not obviously wrong to the
 * student who is asked it next week.
 *
 * Pure, so the rules can be tested without a browser, a key or a network.
 */

/** What a video is declared as when it is handed to the model. */
export const VIDEO_MIME = "video/mp4";

/**
 * The hosts that serve a single video.
 *
 * `youtube-nocookie.com` is here because it is the address people paste when
 * they copy a link out of an embedded player, and it serves exactly the same
 * video.
 */
const VIDEO_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "youtube-nocookie.com",
]);

/** A video id is eleven characters of URL-safe base64. */
const ID = /^[A-Za-z0-9_-]{11}$/;

/** The paths that carry the id as their second segment. */
const ID_PATHS = new Set(["embed", "shorts", "live", "v"]);

/**
 * The video id in a YouTube link, or null when the link is not one.
 *
 * Every shape a link is copied in is accepted, because a student pastes what
 * the app gave them: `watch?v=`, the short `youtu.be/` form, the embed and
 * shorts addresses, and all of them with a playlist or a timestamp hanging off
 * the end.
 */
export function youtubeVideoId(raw: string): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    const id = segments[0] ?? "";
    return ID.test(id) ? id : null;
  }

  if (!VIDEO_HOSTS.has(host)) return null;

  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v") ?? "";
    return ID.test(id) ? id : null;
  }

  if (segments.length >= 2 && ID_PATHS.has(segments[0])) {
    const id = segments[1];
    return ID.test(id) ? id : null;
  }

  return null;
}

/** Whether this link is a video a model can be handed. */
export const isYouTubeVideo = (raw: string) => youtubeVideoId(raw) !== null;

/**
 * A name for a video link.
 *
 * The end of a YouTube address is either the word "watch" or the video's own
 * id, and neither of them tells a student what they saved. This name is what
 * the material is listed as, and what the model is told the video is called.
 */
export function youtubeLabel(raw: string): string | null {
  const id = youtubeVideoId(raw);
  return id ? `YouTube ${id}` : null;
}

/**
 * Every YouTube link inside a piece of text.
 *
 * A student pastes a link into the assistant's box and the only thing they mean
 * by it is "look at this". The links are found inside the sentence rather than
 * the whole address being checked, because a link is almost never the whole
 * question - and the punctuation at the end of a sentence is not part of the
 * address.
 */
export function findYouTubeLinks(text: string): string[] {
  const found = new Set<string>();
  for (const match of (text ?? "").matchAll(/https?:\/\/[^\s<>"'()[\]]+/g)) {
    // A link at the end of a sentence carries the sentence's punctuation with
    // it, and "https://youtu.be/abc." is not an address.
    const address = match[0].replace(/[.,;:!?]+$/, "");
    const uri = youtubeFileUri(address);
    if (uri) found.add(uri);
  }
  return [...found];
}

/**
 * How to read a video, said to the model once.
 *
 * Without it a model asked about a recording will describe the video rather
 * than what was said in it, and will happily write cards about a title card.
 */
export const VIDEO_INSTRUCTION =
  "A video is attached. Watch it and work from what is actually said and shown in it: the lecture's words, its examples and its slides. Do not invent content for parts you could not hear or see, and leave out anything the video does not cover.";

/**
 * The address the model is given.
 *
 * The canonical `watch?v=` form, rebuilt from the id rather than passed
 * through: a link with a playlist, a timestamp or a tracking query attached
 * is still the same video, and handing the model the address it was given
 * means handing it whatever else was in that address.
 */
export function youtubeFileUri(raw: string): string | null {
  const id = youtubeVideoId(raw);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}
