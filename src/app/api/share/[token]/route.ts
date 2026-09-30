import { NextResponse } from "next/server";
import { getShare } from "@/lib/share-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Replaces the base44 `GetSharedSchedule` server function. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const found = await getShare(token);
  if (!found) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(found);
}
