import "server-only";

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Who is calling, and how much of the AI quota they have left.
 *
 * Two separate jobs that belong together because both start from the same thing:
 * the bearer token on the request.
 *
 * Verifying it matters on its own. Several AI routes never touch a material, so
 * there was nothing in them that could tell one student from another, and the
 * server-side keys answered whoever asked. Verifying the token is what makes the
 * quota countable per person - and, on its own, stops an anonymous caller.
 *
 * Both are skipped when Supabase is not configured, because that is the
 * local-first mode: one student on their own machine, no accounts and no quota,
 * where requiring a token would break a setup that works on purpose.
 *
 * The counter is in the database rather than in a map because a serverless deploy
 * runs many instances. A limit held in one instance's memory is one any single
 * call can slip past by landing on another.
 */

/** Requests per hour per person. Overridable, because the right number depends
 * on which provider keys are configured and whether they are free or paid. */
const LIMIT = Number(process.env.AI_RATE_LIMIT_PER_HOUR ?? 25);
const WINDOW_MINUTES = 60;

/** How the caller is told they have run out, in the app's own words. */
function refused(language: "ar" | "en", resetsAt: string | null) {
  const when = resetsAt ? new Date(resetsAt).toISOString() : null;
  return NextResponse.json(
    {
      error: "AI_RATE_LIMIT",
      retryAfter: when,
      message:
        language === "ar"
          ? "استخدمت الحد المسموح دلوقتي. استنى شوية وجرّب تاني."
          : "You have used your allowance for now. Try again shortly.",
    },
    {
      status: 429,
      headers: {
        "retry-after": "3600",
        // So a client can show the time instead of just refusing.
        "x-ratelimit-remaining": "0",
      },
    },
  );
}

const languageOf = (raw: unknown): "ar" | "en" => (raw === "en" ? "en" : "ar");

/** The bearer token, or empty when there is none. */
function tokenOf(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : "";
}

/** A service-role client, for verifying tokens and calling the quota function. */
function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Let the request through, or answer it instead.
 *
 * Returns `null` when the caller may proceed, and a ready-made response when they
 * may not - so a route reads as one line at the top and gets no further on the
 * unhappy path.
 *
 * Note the order: the token is checked before the quota, because the quota is
 * counted per user and an unverified caller has no user to count against. A
 * caller who fails the token check is not charged for the attempt.
 */
export async function guardAiRequest(
  req: Request,
  body?: unknown,
): Promise<NextResponse | null> {
  const admin_ = admin();
  if (!admin_) return null; // local-first: no accounts, no quota

  const language = languageOf((body as { language?: unknown } | null)?.language);
  const token = tokenOf(req);
  if (!token) return unauthenticated(language);

  const { data, error } = await admin_.auth.getUser(token);
  if (error || !data?.user?.id) return unauthenticated(language);

  const limit = Number.isFinite(LIMIT) && LIMIT > 0 ? Math.floor(LIMIT) : 25;

  const { data: result, error: rpcError } = await admin_.rpc("consume_ai_quota", {
    p_user: data.user.id,
    p_limit: limit,
    p_window_mins: WINDOW_MINUTES,
  });

  // A missing function is a deployment that has not run the migration yet. Failing
  // closed would take the AI features offline for everybody; failing open keeps
  // them working and leaves the exposure to one route's worth of calls, which is
  // the smaller problem of the two.
  if (rpcError) return null;

  const row = (Array.isArray(result) ? result[0] : result) as
    | { allowed?: boolean; resets_at?: string }
    | null;
  if (row && row.allowed === false) return refused(language, row.resets_at ?? null);

  return null;
}

function unauthenticated(language: "ar" | "en") {
  return NextResponse.json(
    {
      error: "UNAUTHENTICATED",
      message:
        language === "ar"
          ? "لازم تكون مسجّل دخول."
          : "You need to be signed in.",
    },
    { status: 401 },
  );
}