import { NextResponse } from "next/server";
import { z } from "zod";
import { createShare } from "@/lib/share-server";

export const runtime = "nodejs";

const lecture = z.object({
  id: z.string(),
  subject_name: z.string().default(""),
  subject_en: z.string().default(""),
  code: z.string().default(""),
  doctor: z.string().default(""),
  hall: z.string().default(""),
  day: z.number().min(0).max(6),
  start_time: z.string(),
  end_time: z.string(),
  kind: z.enum(["lecture", "section"]).default("lecture"),
  color: z.string().default("indigo"),
  notes: z.string().default(""),
  department: z.string().default(""),
  created_date: z.string().default(""),
});

const event = z.object({
  id: z.string(),
  title: z.string(),
  title_en: z.string().default(""),
  date: z.string(),
  type: z.enum(["holiday", "announcement", "exam", "event"]).default("event"),
  note: z.string().default(""),
});

const bodySchema = z.object({
  owner_name: z.string().max(80).optional(),
  // At least one lecture: an empty link shows nobody anything, and accepting
  // it would let anyone fill the store with useless tokens.
  lectures: z.array(lecture).min(1).max(500),
  events: z.array(event).max(200).default([]),
});

/** Replaces the base44 `CreateShareLink` server function. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 },
    );
  }
  const t = await createShare(parsed.data);
  return NextResponse.json({ token: t });
}
