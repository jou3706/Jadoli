"use client";

/**
 * The alarm you can hear.
 *
 * Synthesized rather than an audio file, for two reasons. It works with no
 * network, because there is nothing to fetch. And it is as loud as the device
 * allows, because a file arrives at whatever volume whoever recorded it and
 * cannot be turned up; an oscillator's gain is ours to set.
 *
 * The browser will not let any of this make a sound until a person has touched
 * the page, so the context has to be unlocked from a click. Until then the alarm
 * is silent, and the interface says so rather than pretending.
 */

import { soundEnabled } from "./alarm-prefs";

type Ctx = AudioContext & { __jadwaliAlarm?: boolean };

let ctx: Ctx | null = null;

const context = (): Ctx | null => {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor() as Ctx;
  return ctx;
};

/**
 * Called from a tap. Returns whether sound is now allowed to play.
 *
 * A context can be created long before it is allowed to speak, which is why
 * this exists rather than creating the context at the moment of the alarm:
 * resuming it inside a user gesture is the only moment it is permitted to
 * start.
 */
export async function unlockSound(): Promise<boolean> {
  const c = context();
  if (!c) return false;
  try {
    if (c.state === "suspended") await c.resume();
    c.__jadwaliAlarm = c.state === "running";
    if (!c.__jadwaliAlarm) return false;
    // A moment of near-silence, so the gesture that unlocked this counts as a
    // gesture that played something. Browsers decide on the first sound.
    const osc = c.createOscillator();
    const gain = c.createGain();
    gain.gain.value = 0.0001;
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.06);
    return true;
  } catch {
    return false;
  }
}

/** Whether a person has allowed sound. False until they have tapped. */
export const soundUnlocked = () => ctx?.state === "running";

/** Whether this browser can make any sound at all. */
export const soundSupported = () => {
  if (typeof window === "undefined") return false;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  // Asked without instantiating: a check should not be the thing that creates
  // an audio context.
  return !!Ctor;
};

/**
 * The vibrate pattern, and whether this device has a motor.
 *
 * Separate from the sound because a phone in a pocket should buzz as well as
 * ring - a noise that is only audible on a table is a noise that misses.
 */
export const vibrate = (pattern: number[]) => {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
      return true;
    }
  } catch {
    /* not supported, or blocked by the user */
  }
  return false;
};

/** Stop any buzz left over, on the way out of the page too. */
export const stopVibration = () => {
  try {
    navigator.vibrate?.(0);
  } catch {
    /* nothing to stop */
  }
};

/** Three pulses, a pause, then again - the shape of an exam bell. */
const PULSE: { at: number; hz: number; len: number; gain: number }[] = [
  { at: 0, hz: 880, len: 0.22, gain: 1 },
  { at: 0.26, hz: 880, len: 0.22, gain: 1 },
  { at: 0.52, hz: 1174.7, len: 0.34, gain: 1 },
  { at: 1.02, hz: 659.3, len: 0.5, gain: 0.85 },
];

const CYCLE = 2.1;

/**
 * Ringing, held open until stopped.
 *
 * Every pulse is scheduled ahead on the audio clock rather than fired from a
 * timer, because a timer drifts and a drifted alarm sounds sloppy. The
 * scheduler runs once per cycle and books the whole cycle.
 */
export class Alarm {
  private timer: number | null = null;
  private buzz: number | null = null;
  private nodes: { stop: (t: number) => void }[] = [];
  running = false;

  start() {
    if (this.running) return;
    const c = context();
    if (!c) return;
    this.running = true;

    const tick = () => {
      if (!this.running || !ctx) return;
      // The previous cycle is over - it is longer than the longest pulse - so
      // these references are all this needs to hold. Keeping every node ever
      // made would grow for as long as somebody is being alarmed.
      this.nodes = [];
      // The switch is read every cycle, not once at the start, so turning the
      // sound off mid-ring actually stops it.
      if (!soundEnabled()) {
        this.buzz = window.setTimeout(() => vibrate(Array.from({ length: CYCLE * 10 }, (_, i) => (i % 5 < 3 ? 200 : 0))), 0);
        return;
      }
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime + 0.05;
      for (const p of PULSE) {
        const at = now + p.at;
        // A square wave at full gain: it is the harshest tone a speaker can
        // reproduce, and harshness is what carries through a phone on a table.
        const osc = ctx.createOscillator();
        osc.type = "square";
        osc.frequency.setValueAtTime(p.hz, at);
        // A fifth below, quieter, underneath. It gives the tone a body that
        // survives small laptop speakers, which lose the top end first.
        const body = ctx.createOscillator();
        body.type = "triangle";
        body.frequency.setValueAtTime(p.hz / 2, at);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(p.gain, at + 0.015);
        gain.gain.setValueAtTime(p.gain, at + p.len - 0.05);
        gain.gain.linearRampToValueAtTime(0, at + p.len);
        const bodyGain = ctx.createGain();
        bodyGain.gain.value = 0.35;
        osc.connect(gain).connect(ctx.destination);
        body.connect(bodyGain).connect(gain);
        osc.start(at);
        body.start(at);
        osc.stop(at + p.len + 0.02);
        body.stop(at + p.len + 0.02);
        this.nodes.push(osc, body);
      }
      // Buzz with the sound, not instead of it.
      this.buzz = window.setTimeout(
        () =>
          vibrate(
            Array.from({ length: CYCLE * 10 }, (_, i) => (i % 5 < 3 ? 200 : 0)),
          ),
        0,
      );
    };

    tick();
    this.timer = window.setInterval(tick, CYCLE * 1000);
  }

  stop() {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.buzz !== null) {
      clearTimeout(this.buzz);
      this.buzz = null;
    }
    stopVibration();
    const c = ctx;
    if (c) {
      // Stopping at the current time rather than disconnecting leaves whatever
      // is already sounding to finish, so a stop mid-pulse does not click.
      for (const n of this.nodes) {
        try {
          n.stop(c.currentTime);
        } catch {
          /* already stopped */
        }
      }
    }
    this.nodes = [];
  }
}

/** A short confirmation, for the button that turns the sound on. */
export function previewChime() {
  const c = context();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  const now = c.currentTime + 0.02;
  [523.25, 659.25, 783.99].forEach((hz, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = hz;
    const at = now + i * 0.12;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.5, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
    osc.connect(gain).connect(c.destination);
    osc.start(at);
    osc.stop(at + 0.52);
  });
}
