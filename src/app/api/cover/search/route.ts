import "server-only";

import { NextResponse } from "next/server";
import { coverQuery, rankCandidates } from "@/lib/cover-search";

export const runtime = "nodejs";

/**
 * Cover images from Wikimedia Commons.
 *
 * No API key, no quota and proper licensing — unlike image generation, this
 * keeps working. Commons is a public read API, so the request is made here to
 * keep the ranking on the server and out of the client bundle.
 */

const ENDPOINT = "https://commons.wikimedia.org/w/api.php";

export async function GET(req: Request) {
  const subject = (new URL(req.url).searchParams.get("subject") ?? "").trim().slice(0, 120);
  if (!subject) {
    return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  }

  const url =
    `${ENDPOINT}?action=query&format=json&origin=*&generator=search` +
    `&gsrnamespace=6&gsrlimit=30` +
    `&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1024` +
    `&gsrsearch=${encodeURIComponent(coverQuery(subject))}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Jadwali/1.0 (student app)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Commons ${res.status}` },
        { status: 502 },
      );
    }

    const json = (await res.json()) as {
      query?: { pages?: Record<string, unknown> };
    };
    const pages = json.query?.pages ? Object.values(json.query.pages) : [];
    const images = rankCandidates(pages as never[], subject);

    return NextResponse.json({ images, source: "wikimedia" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "search failed" },
      { status: 502 },
    );
  }
}
