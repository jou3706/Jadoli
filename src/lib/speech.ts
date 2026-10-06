"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Speaking a question instead of typing it.
 *
 * Built on the Web Speech API, which is the only thing in the browser that can
 * do this: Chrome, Edge and Safari implement it, Firefox does not, so the button
 * is disabled rather than missing where it cannot work.
 *
 * The parts worth reading carefully are the two ways this API does not do what it
 * says, both of which are handled here and neither of which is obvious:
 *
 *  1. `continuous = true` does not mean it keeps listening. Chrome ends the
 *     session after a pause in speech anyway, so the recogniser has to be started
 *     again from `onend` or dictation stops the first time somebody thinks for a
 *     second. Only a deliberate stop stops it for good.
 *
 *  2. The language is chosen explicitly, never guessed. In Chrome an unset
 *     `lang` does not work the language out from the speech the way the spec
 *     suggests - it quietly uses the browser's own UI language, so a Chrome
 *     whose UI is English hears English and nothing else. The recogniser pins a
 *     `DictationLang` on `rec.lang` instead. Switching mid-session is still
 *     possible, but it is the student switching, by choosing the language before
 *     or during a session; the engine is never asked to decide.
 */

/** One recognised phrase, flattened out of the API's array-like result list. */
export type Phrase = { text: string; final: boolean; lang?: string };

/** What the recogniser knows so far: what is settled, and what is still changing. */
export type Transcript = {
  committed: string;
  interim: string;
  /** BCP-47 tag for the newest phrase that reported one, e.g. `ar-EG`. */
  detected: string | null;
};

/**
 * The API's results are cumulative for the whole session, so the honest way to
 * read them is to rebuild the transcript from the start each time rather than
 * appending to a local string. Events can be missed - a dropped `onresult` would
 * otherwise leave a permanent hole - and this way nothing accumulates wrongly.
 *
 * Only the newest unfinished phrase is interim: earlier ones are being revised
 * and will arrive again, so taking them all would show the same words twice.
 */
export function splitTranscript(results: Iterable<Phrase>): Transcript {
  const final: string[] = [];
  let interim = "";
  let detected: string | null = null;

  for (const r of results) {
    const text = r.text.trim();
    if (r.lang) detected = r.lang;
    if (!text) continue;
    if (r.final) final.push(text);
    else interim = text;
  }

  return { committed: final.join(" "), interim, detected };
}

/**
 * The whole input box, given what was already typed before dictation started.
 *
 * Dictation is added to what is there rather than replacing it, because stopping
 * to read a question before answering it out loud is exactly the pause that ends a
 * `continuous` session.
 */
export function composeDictation(base: string, committed: string, interim: string): string {
  return [base, committed, interim]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The two languages this app speaks, from whatever tag the engine reported.
 *
 * Split on the separator rather than testing a prefix: `startsWith("en")` also
 * accepts `enigma`, which would label a language the assistant does not speak as
 * English. An underscore is accepted alongside the hyphen because some Android
 * WebViews report it, and the only thing riding on the answer is a label.
 */
export function langOf(tag: string | null | undefined): "ar" | "en" | null {
  if (!tag) return null;
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  if (primary === "ar") return "ar";
  if (primary === "en") return "en";
  return null;
}

/**
 * The two languages dictation can be pinned to, because recognition does not
 * mix languages: one session belongs to exactly one, chosen by the student
 * rather than inferred by the engine (see the note at the top of this file).
 */
export type DictationLang = "ar" | "en";

/**
 * Whether an ended session should be started again.
 *
 * Only the interruptions that mean "keep going". `not-allowed` is a permission
 * the user refused and `audio-capture` is a machine with no usable microphone -
 * restarting either would either be refused forever or spin the CPU. `network` is
 * the recogniser's own service being unreachable, which no amount of retrying
 * from here fixes. `aborted` is us stopping on purpose.
 *
 * No code at all is the silence case from the note at the top, and is the one
 * that matters.
 */
export function shouldRestart(code: string | null | undefined): boolean {
  return !code || code === "no-speech";
}

/** The `SpeechRecognition` surface this module uses, declared because the DOM
 * lib in TypeScript has the result types but not the recogniser itself. */
type Recognizer = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: { length: number; [i: number]: SpeechResultLike } }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechResultLike = { isFinal: boolean; length: number; 0: { transcript: string; lang: string } };

declare global {
  interface Window {
    SpeechRecognition?: new () => Recognizer;
    webkitSpeechRecognition?: new () => Recognizer;
  }
}

/** The recogniser constructor, or null where the browser has none. */
export function recognizer(): (new () => Recognizer) | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/** Whether dictation can work at all here: the API, and a secure context. */
export function canDictate(): boolean {
  return recognizer() !== null && typeof window !== "undefined" && window.isSecureContext !== false;
}

export type SpeechError =
  | "unsupported"
  | "not-allowed"
  | "audio-capture"
  | "network"
  | null;

export function useSpeechToText(onText: (text: string) => void, lang?: DictationLang) {
  const [listening, setListening] = useState(false);
  const [detected, setDetected] = useState<"ar" | "en" | null>(null);
  const [error, setError] = useState<SpeechError>(null);
  const [supported, setSupported] = useState(true);

  const recRef = useRef<Recognizer | null>(null);
  /** Whether the student still wants to listen. The recogniser's own state cannot
   * answer this, because it stops itself on every pause. */
  const wantRef = useRef(false);
  /**
   * Everything in the box that does not belong to the current session: what was
   * there when dictation started, plus anything typed while it ran. The session's
   * own phrases are kept in `committedRef`/`interimRef` and folded into `baseRef`
   * on every restart, so a pause in speech never loses what was already said.
   */
  const baseRef = useRef("");
  const committedRef = useRef("");
  const interimRef = useRef("");
  /** The last recognised fault, read by `onend` to decide whether the session
   * should start again. `no-speech`/none mean the engine paused on silence and
   * must restart; everything else is a stop. */
  const errorRef = useRef<string | null>(null);
  const onTextRef = useRef(onText);
  const langRef = useRef<DictationLang | undefined>(lang);

  // Read through a ref so the handlers below never close over a stale callback.
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  // Whether the browser has the API is only knowable after mount, and rendering
  // it differently before and after would be a hydration mismatch.
  useEffect(() => {
    setSupported(canDictate());
  }, []);

  // Leaving the page must not leave a microphone running.
  useEffect(
    () => () => {
      wantRef.current = false;
      try {
        recRef.current?.abort();
      } catch {
        /* already stopped */
      }
      recRef.current = null;
    },
    [],
  );

  const start = useCallback((base: string) => {
    const Ctor = recognizer();
    if (!Ctor) {
      setSupported(false);
      setError("unsupported");
      return;
    }
    setError(null);
    // Another recogniser may still be winding down (a language switch stops the
    // old one right before this runs). End it first, or two live sessions fight
    // over the microphone and the input box.
    try {
      recRef.current?.abort();
    } catch {
      /* already stopped */
    }
    baseRef.current = base;
    committedRef.current = "";
    interimRef.current = "";
    errorRef.current = null;
    wantRef.current = true;

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    // The chosen language is pinned on the instance. Leaving it unset is not
    // "detect it yourself" - Chrome resolves it to its own UI language, which is
    // the whole English-only bug - so the page always passes one. Restarting a
    // paused session re-reads `langRef`, which is how a mid-session switch takes
    // effect on the next recogniser.
    const chosen = langRef.current;
    if (chosen) rec.lang = chosen;

    rec.onresult = (event) => {
      // A recogniser that was replaced (new language, new session) must not write
      // into a box the newer one owns, or the two would overwrite each other.
      if (recRef.current !== rec) return;
      const phrases: Phrase[] = [];
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        phrases.push({
          text: r[0]?.transcript ?? "",
          final: r.isFinal,
          lang: r[0]?.lang,
        });
      }
      const { committed, interim, detected: tag } = splitTranscript(phrases);
      committedRef.current = committed;
      interimRef.current = interim;
      const lang = langOf(tag);
      if (lang) setDetected(lang);
      onTextRef.current(composeDictation(baseRef.current, committed, interim));
    };

    rec.onerror = (event) => {
      errorRef.current = event.error;
      // Silence and a deliberate stop both end up here; neither is a fault and
      // neither should put an error on screen. Silence keeps listening (the
      // restart happens in `onend`); `aborted` is us stopping on purpose, so the
      // next `onend` must leave it off.
      if (event.error === "no-speech") return;
      if (event.error === "aborted") {
        wantRef.current = false;
        return;
      }
      wantRef.current = false;
      setError(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "not-allowed"
          : event.error === "audio-capture"
            ? "audio-capture"
            : "network",
      );
    };

    rec.onend = () => {
      if (recRef.current !== rec) return;
      // This is the silence case. Chrome ends the session after a pause even
      // though `continuous` is true, so it is started again - and only a
      // deliberate stop, or a real fault, leaves it off.
      if (!wantRef.current || !shouldRestart(errorRef.current)) {
        setListening(false);
        if (recRef.current === rec) recRef.current = null;
        return;
      }
      // The new session's results start from nothing, so everything this session
      // heard is folded into the base before it restarts. Without this, a pause
      // in speech silently wipes what was already dictated.
      baseRef.current = composeDictation(
        baseRef.current,
        committedRef.current,
        interimRef.current,
      );
      committedRef.current = "";
      interimRef.current = "";
      errorRef.current = null;
      try {
        rec.start();
      } catch {
        wantRef.current = false;
        setListening(false);
        if (recRef.current === rec) recRef.current = null;
      }
    };

    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      wantRef.current = false;
      setListening(false);
      if (recRef.current === rec) recRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    wantRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    setListening(false);
    try {
      rec?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  return {
    supported,
    listening,
    detected,
    error,
    start,
    stop,
    /**
     * The box's current text, only called by the page when it edited the box
     * itself while dictation was running. The recogniser scans the session's own
     * phrases against this, so typing mid-session is preserved instead of being
     * overwritten by the next recognised word.
     */
    setBase: useCallback((text: string) => {
      baseRef.current = text;
    }, []),
    toggle: useCallback((base: string) => {
      if (wantRef.current) stop();
      else start(base);
    }, [start, stop]),
  };
}