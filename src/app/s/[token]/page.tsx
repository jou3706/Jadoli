import { notFound } from "next/navigation";
import { getShare } from "@/lib/share-server";
import { SharedSchedule } from "@/components/schedule/shared-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SharedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const payload = await getShare(token);
  if (!payload) notFound();

  return <SharedSchedule payload={payload} />;
}
