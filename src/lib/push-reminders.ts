"use client";

import { authHeader } from "@/lib/db/supabase-client";
import { isPushSubscribed } from "@/lib/push-subscription";

/**
 * Asking the server for this student's own reminders.
 *
 * The scheduled job in the database is what covers a phone with the app
 * closed. It is installed by a migration, and until that is done a student
 * with the app open would still not be reminded of the exam they are looking
 * at - the one case where they can see the reminder is missing.
 *
 * So the app asks for its own. The server works out what this reader owes and
 * pushes it to this reader's browsers, and cannot touch anybody else's.
 *
 * Three rules keep it from being a way to spend the push service's quota:
 * it only runs when there is a subscription to deliver to, only while the page
 * is in front of the student, and only once a minute.
 */

/** How often the app asks. The database job runs every minute; so does this. */
const EVERY_MS = 60_000;

/** A request that is still running when the next one is due is not repeated. */
let inFlight = false;

export async function requestOwnReminders(): Promise<void> {
  if (inFlight) return;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  inFlight = true;
  try {
    if (!(await isPushSubscribed())) return;
    const headers = await authHeader();
    if (!headers.Authorization) return;
    await fetch("/api/push/tick", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
    });
  } catch {
    // A failed ask is not worth a sound: the database job is still there, and
    // the next minute will ask again.
  } finally {
    inFlight = false;
  }
}
